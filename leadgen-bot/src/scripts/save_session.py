#!/usr/bin/env python3
"""
Interactive session saver for Twitter/X authentication.

Usage:
    python3 save_session.py
    
    1. Browser opens
    2. Log in to x.com (if not already logged in)
    3. Press Enter in terminal
    4. Cookies saved to specified file
"""

import json
import os
import sys
from datetime import datetime

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("ERROR: playwright not installed. Run: pip3 install playwright")
    print("Then: playwright install chromium")
    sys.exit(1)


def save_session(output_path: str = "cookies/twitter_session.json"):
    """Launch browser, let user login, then save cookies."""
    
    print("=" * 60)
    print("Twitter/X Session Saver")
    print("=" * 60)
    print()
    print(f"Output file: {output_path}")
    print()
    print("Instructions:")
    print("1. A browser window will open")
    print("2. Log in to x.com if not already logged in")
    print("3. Return to this terminal and press Enter")
    print("4. Cookies will be saved to the output file")
    print()
    input("Press Enter to start...")
    print()
    
    with sync_playwright() as p:
        # Launch browser in non-headless mode so user can interact
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(
            viewport={'width': 1280, 'height': 800}
        )
        
        page = context.new_page()
        
        # Navigate to Twitter/X
        print("Opening x.com...")
        page.goto("https://x.com")
        
        print()
        print("Browser is open. Please:")
        print("- Log in if you're not already logged in")
        print("- Complete any 2FA/security challenges")
        print("- Navigate to your home feed")
        print()
        input("When you're logged in and on the home feed, press Enter here to save cookies...")
        
        # Get cookies
        cookies = context.cookies()
        
        # Create output directory if needed
        output_dir = os.path.dirname(output_path)
        if output_dir and not os.path.exists(output_dir):
            os.makedirs(output_dir)
        
        # Save cookies to file
        session_data = {
            "cookies": cookies,
            "created_at": datetime.utcnow().isoformat() + "Z",
            "url": "https://x.com"
        }
        
        with open(output_path, 'w') as f:
            json.dump(session_data, f, indent=2)
        
        print()
        print(f"✅ Saved {len(cookies)} cookies to: {output_path}")
        
        # Check for required cookies
        cookie_names = [c['name'] for c in cookies]
        required = ['auth_token', 'ct0']
        missing = [r for r in required if r not in cookie_names]
        
        if missing:
            print(f"⚠️  Warning: Missing required cookies: {', '.join(missing)}")
            print("   You may need to log in again.")
        else:
            print("✅ All required cookies present (auth_token, ct0)")
        
        print()
        print("Cookie summary:")
        for cookie in cookies:
            secure = "🔒" if cookie.get('secure') else ""
            http_only = " (httpOnly)" if cookie.get('httpOnly') else ""
            print(f"  - {cookie['name']}: {secure}{http_only}")
        
        browser.close()
        
        print()
        print("Done! You can now use these cookies with the scraper.")
        print(f"Set TWITTER_COOKIES_PATH={output_path}")


if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='Save Twitter/X session cookies')
    parser.add_argument(
        '--output', '-o',
        default='cookies/twitter_session.json',
        help='Output file path (default: cookies/twitter_session.json)'
    )
    
    args = parser.parse_args()
    save_session(args.output)
