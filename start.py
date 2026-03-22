#!/usr/bin/env python3
"""
Proxy local server — serves files with correct MIME types for SW registration.
Run: python start.py
Then open: http://localhost:8080
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

print(f'Proxy server running at http://localhost:{PORT}')
print('Open that URL in your browser.')
print('Press Ctrl+C to stop.\n')
with socketserver.TCPServer(('', PORT), Handler) as httpd:
    httpd.serve_forever()