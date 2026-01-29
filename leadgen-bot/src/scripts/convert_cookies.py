#!/usr/bin/env python3
"""
Convert cookies from Netscape format (Cookie-Editor export) to JSON format.

Usage:
    python3 convert_cookies.py cookies.txt cookies/twitter_session.json
"""

import json
import sys
import os
from datetime import datetime


def parse_netscape_cookies(content: str) -> list:
    """Parse Netscape format cookies."""
    cookies = []
    
    for line in content.split('\n'):
        line = line.strip()
        
        # Skip comments and empty lines
        if not line or line.startswith('#'):
            continue
        
        parts = line.split('\t')
        if len(parts) >= 7:
            # Netscape format: domain	flag	path	secure	expiration	name	value
            domain, flag, path, secure, expiration, name, value = parts[:7]
            
            cookie = {
                'name': name,
                'value': value,
                'domain': domain,
                'path': path,
                'secure': secure.lower() == 'true',
            }
            
            # Add expiration if present and valid
            if expiration and expiration != '0':
                try:
                    cookie['expires'] = int(expiration)
                except ValueError:
                    pass
            
            # httpOnly is not in Netscape format, infer from common names
            cookie['httpOnly'] = name in ['auth_token', 'twid']
            
            cookies.append(cookie)
    
    return cookies


def convert_cookies(input_path: str, output_path: str):
    """Convert cookies from Netscape to JSON format."""
    
    print(f"Reading: {input_path}")
    
    with open(input_path, 'r') as f:
        content = f.read()
    
    cookies = parse_netscape_cookies(content)
    
    if not cookies:
        print("ERROR: No cookies found in input file")
        sys.exit(1)
    
    print(f"Parsed {len(cookies)} cookies")
    
    # Create session data
    session_data = {
        "cookies": cookies,
        "created_at": datetime.utcnow().isoformat() + "Z",
        "source": "netscape-converted"
    }
    
    # Create output directory if needed
    output_dir = os.path.dirname(output_path)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir)
    
    # Write output
    with open(output_path, 'w') as f:
        json.dump(session_data, f, indent=2)
    
    print(f"Saved to: {output_path}")
    
    # Validate required cookies
    cookie_names = [c['name'] for c in cookies]
    required = ['auth_token', 'ct0']
    missing = [r for r in required if r not in cookie_names]
    
    if missing:
        print(f"⚠️  Warning: Missing recommended cookies: {', '.join(missing)}")
    else:
        print("✅ All required cookies present")
    
    print("\nCookie names found:")
    for name in cookie_names:
        print(f"  - {name}")


if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(
        description='Convert Netscape format cookies to JSON'
    )
    parser.add_argument('input', help='Input Netscape cookies file')
    parser.add_argument(
        'output',
        nargs='?',
        default='cookies/twitter_session.json',
        help='Output JSON file (default: cookies/twitter_session.json)'
    )
    
    args = parser.parse_args()
    
    if not os.path.exists(args.input):
        print(f"ERROR: Input file not found: {args.input}")
        sys.exit(1)
    
    convert_cookies(args.input, args.output)
