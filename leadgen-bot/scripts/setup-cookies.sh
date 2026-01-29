#!/bin/bash
#
# Cookie Setup Helper Script
#
# Interactive script to guide users through cookie setup
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Twitter Cookie Setup Helper${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}ERROR: python3 is required but not installed${NC}"
    exit 1
fi

# Create cookies directory
mkdir -p cookies

echo -e "${BLUE}Choose a setup method:${NC}"
echo ""
echo "1) Interactive browser login (recommended)"
echo "   - Opens browser for you to log in"
echo "   - Automatically saves cookies"
echo ""
echo "2) Convert from Cookie-Editor export"
echo "   - Export cookies from browser extension"
echo "   - Convert Netscape format to JSON"
echo ""
echo "3) Check existing cookies"
echo "   - Validate cookies/twitter_session.json"
echo ""

read -p "Enter choice (1-3): " choice

case $choice in
    1)
        echo ""
        echo -e "${BLUE}Starting interactive session saver...${NC}"
        echo ""
        python3 src/scripts/save_session.py --output cookies/twitter_session.json
        ;;
    
    2)
        echo ""
        echo -e "${BLUE}Cookie conversion${NC}"
        echo ""
        echo "Steps:"
        echo "  1. Install 'Cookie-Editor' extension in Chrome/Firefox"
        echo "  2. Go to x.com and log in"
        echo "  3. Click Cookie-Editor icon"
        echo "  4. Click 'Export' -> 'Export as Netscape'
        echo "  5. Save the file (e.g., cookies.txt)"
        echo ""
        read -p "Enter path to exported cookies file: " input_file
        
        if [ ! -f "$input_file" ]; then
            echo -e "${RED}ERROR: File not found: $input_file${NC}"
            exit 1
        fi
        
        python3 src/scripts/convert_cookies.py "$input_file" cookies/twitter_session.json
        ;;
    
    3)
        echo ""
        if [ ! -f "cookies/twitter_session.json" ]; then
            echo -e "${RED}ERROR: No cookies found at cookies/twitter_session.json${NC}"
            exit 1
        fi
        
        echo -e "${BLUE}Validating cookies...${NC}"
        
        # Check if valid JSON
        if ! python3 -c "import json; json.load(open('cookies/twitter_session.json'))" 2>/dev/null; then
            echo -e "${RED}ERROR: Invalid JSON in cookies file${NC}"
            exit 1
        fi
        
        # Check for required cookies
        python3 << 'EOF'
import json
import sys

try:
    with open('cookies/twitter_session.json', 'r') as f:
        data = json.load(f)
    
    cookies = data.get('cookies', [])
    print(f"Total cookies: {len(cookies)}")
    
    cookie_names = [c['name'] for c in cookies]
    
    required = ['auth_token', 'ct0']
    optional = ['twid', 'guest_id']
    
    print("\nRequired cookies:")
    for name in required:
        status = "✓" if name in cookie_names else "✗ MISSING"
        color = "\033[0;32m" if name in cookie_names else "\033[0;31m"
        print(f"  {color}{name}: {status}\033[0m")
    
    print("\nOptional cookies:")
    for name in optional:
        status = "✓" if name in cookie_names else "○ not found"
        print(f"  {name}: {status}")
    
    if not all(name in cookie_names for name in required):
        print("\n\033[0;31mERROR: Missing required cookies!\033[0m")
        sys.exit(1)
    else:
        print("\n\033[0;32m✓ All required cookies present!\033[0m")
        
except Exception as e:
    print(f"\033[0;31mERROR: {e}\033[0m")
    sys.exit(1)
EOF
        ;;
    
    *)
        echo -e "${RED}Invalid choice${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}Setup complete!${NC}"
echo ""
echo "You can now run the scraper with:"
echo "  ./scripts/run-twitter-local.sh"
