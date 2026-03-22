#!/usr/bin/env python3
"""
Run: python start.py
Open: http://localhost:8080
"""
import http.server, socketserver, os, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Service-Worker-Allowed', '/')
        super().end_headers()
    def guess_type(self, path):
        if path.endswith('.js'): return 'application/javascript'
        return super().guess_type(path)
    def log_message(self, fmt, *args):
        print(f'  {args[0]} {args[1]}')

print(f'\nProxy running at http://localhost:{PORT}')
print('Press Ctrl+C to stop.\n')
with socketserver.TCPServer(('', PORT), Handler) as httpd:
    httpd.serve_forever()