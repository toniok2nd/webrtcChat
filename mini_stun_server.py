#!/usr/bin/env python3
"""
mini_stun_server.py

A tiny STUN Binding‑Response server (RFC‑5389) implemented with asyncio.
It handles only the mandatory Binding Request and replies with a Binding Response
that contains a MAPPED‑ADDRESS attribute (IPv4 only).  No authentication,
no TURN, no error handling beyond the basics – this is for learning or
internal‑LAN testing only.

Run:
    $ python3 mini_stun_server.py [--host HOST] [--port PORT]

Test (from another machine):
    $ pip install pystun3
    $ python -c "import stun; print(stun.get_ip_info('SERVER_IP',3478))"
    # or use the `stun` CLI tool, or netcat with a raw packet.
"""

import argparse
import asyncio
import logging
import struct
import socket

# ----------------------------------------------------------------------
# STUN constants (RFC 5389)
# ----------------------------------------------------------------------
STUN_BINDING_REQUEST  = 0x0001
STUN_BINDING_RESPONSE = 0x0101
STUN_MAGIC_COOKIE = 0x2112A442

# Attribute types we will emit
ATTR_MAPPED_ADDRESS = 0x0001   # legacy IPv4‑only attribute

# ----------------------------------------------------------------------
# Helper: build a MAPPED‑ADDRESS attribute (IPv4 only)
# ----------------------------------------------------------------------
def build_mapped_address_attr(addr: str, port: int) -> bytes:
    """Return a binary MAPPED‑ADDRESS attribute.
    Layout (RFC 5389, Section 15.1):
        0‑1  : Attribute Type (0x0001)
        2‑3  : Length (8)
        4    : Reserved (0)
        5    : Family (0x01 = IPv4)
        6‑7  : Port (network byte order)
        8‑11 : IPv4 address (network byte order)
    """
    family = 0x01                      # IPv4
    port_be = struct.pack('!H', port)   # 2‑byte big‑endian
    ip_be   = socket.inet_aton(addr)    # 4‑byte binary IPv4
    payload = b'\x00' + bytes([family]) + port_be + ip_be
    header  = struct.pack('!HH', ATTR_MAPPED_ADDRESS, len(payload))
    return header + payload

# ----------------------------------------------------------------------
# Helper: encode a full STUN message (header + optional attributes)
# ----------------------------------------------------------------------
def build_stun_message(msg_type: int, transaction_id: bytes, attributes: bytes = b'') -> bytes:
    """Construct a STUN message.
    Header (20 bytes):
        0‑1   : Message Type
        2‑3   : Message Length (bytes after the header)
        4‑7   : Magic Cookie (0x2112A442)
        8‑19  : Transaction ID (12 bytes)
    """
    if len(transaction_id) != 12:
        raise ValueError('Transaction ID must be exactly 12 bytes')
    length = len(attributes)
    header = struct.pack('!HHI12s', msg_type, length, STUN_MAGIC_COOKIE, transaction_id)
    return header + attributes

# ----------------------------------------------------------------------
# Parser for a received STUN packet – returns (msg_type, transaction_id)
# ----------------------------------------------------------------------
def parse_stun_header(data: bytes):
    """Validate the header and extract (msg_type, transaction_id).
    Raises ValueError on malformed packets.
    """
    if len(data) < 20:
        raise ValueError('STUN packet too short')
    msg_type, msg_len, magic, trans_id = struct.unpack('!HHI12s', data[:20])
    if magic != STUN_MAGIC_COOKIE:
        raise ValueError(f'Bad magic cookie {hex(magic)}')
    if len(data) != 20 + msg_len:
        raise ValueError('STUN length field mismatch')
    return msg_type, trans_id

# ----------------------------------------------------------------------
# The asyncio DatagramProtocol that does the real work
# ----------------------------------------------------------------------
class StunProtocol(asyncio.DatagramProtocol):
    def __init__(self, logger: logging.Logger):
        self.logger = logger

    def connection_made(self, transport):
        self.transport = transport
        sock = transport.get_extra_info('socket')
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.logger.info('STUN server listening on %s', transport.get_extra_info('sockname'))

    def datagram_received(self, data, addr):
        client_ip, client_port = addr
        self.logger.debug('Received %d bytes from %s:%d', len(data), client_ip, client_port)
        try:
            msg_type, trans_id = parse_stun_header(data)
        except ValueError as exc:
            self.logger.warning('Invalid STUN packet from %s:%d – %s', client_ip, client_port, exc)
            return
        if msg_type != STUN_BINDING_REQUEST:
            self.logger.info('Ignoring non‑Binding request (type %04x) from %s:%d', msg_type, client_ip, client_port)
            return
        # Build MAPPED‑ADDRESS attribute with the address we saw
        attr = build_mapped_address_attr(client_ip, client_port)
        response = build_stun_message(STUN_BINDING_RESPONSE, trans_id, attr)
        self.transport.sendto(response, addr)
        self.logger.info('Sent Binding Response to %s:%d (public %s:%d)', client_ip, client_port, client_ip, client_port)

# ----------------------------------------------------------------------
# Entry point – parse CLI arguments, start asyncio loop
# ----------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description='Tiny STUN Binding‑Response server')
    parser.add_argument('--host', default='0.0.0.0', help='IP address to bind (default: all interfaces)')
    parser.add_argument('--port', type=int, default=3478, help='UDP port to listen on (default: 3478)')
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)-8s %(message)s', datefmt='%H:%M:%S')
    logger = logging.getLogger('mini-stun')

    loop = asyncio.get_event_loop()
    listen = loop.create_datagram_endpoint(
        lambda: StunProtocol(logger),
        local_addr=(args.host, args.port)
    )
    transport, _ = loop.run_until_complete(listen)
    try:
        logger.info('Press Ctrl‑C to stop')
        loop.run_forever()
    except KeyboardInterrupt:
        logger.info('Shutting down')
    finally:
        transport.close()
        loop.stop()

if __name__ == '__main__':
    main()
