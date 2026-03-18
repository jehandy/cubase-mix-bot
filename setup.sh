#!/bin/bash
# Cubase MCP Setup Script for macOS
# Installs the Cubase MIDI Remote script and verifies IAC Driver

set -e

echo "=== Cubase MCP Bridge Setup ==="
echo ""

# 1. Install Cubase MIDI Remote script
CUBASE_SCRIPTS_DIR="$HOME/Documents/Steinberg/Cubase/MIDI Remote/Driver Scripts/Local/claude_mcp"

echo "Step 1: Installing Cubase MIDI Remote script..."
mkdir -p "$CUBASE_SCRIPTS_DIR"
cp cubase-script/claude_mcp.js "$CUBASE_SCRIPTS_DIR/"
echo "  ✅ Script installed to: $CUBASE_SCRIPTS_DIR"
echo ""

# 2. Install npm dependencies
echo "Step 2: Installing npm dependencies..."
npm install
echo "  ✅ Dependencies installed"
echo ""

# 3. Check for IAC Driver
echo "Step 3: Checking IAC Driver..."
if system_profiler SPMIDIDataType 2>/dev/null | grep -q "IAC Driver"; then
  echo "  ✅ IAC Driver is present"
else
  echo "  ⚠️  IAC Driver not detected. Please enable it:"
  echo "     1. Open Applications > Utilities > Audio MIDI Setup"
  echo "     2. Go to Window > Show MIDI Studio"
  echo "     3. Double-click 'IAC Driver'"
  echo "     4. Check 'Device is online'"
  echo "     5. Add two buses:"
  echo "        - 'Claude MCP Out'  (MCP server → Cubase)"
  echo "        - 'Claude MCP In'   (Cubase → MCP server)"
  echo "     6. Click Apply"
fi
echo ""

# 4. Print Claude Desktop config
echo "Step 4: Add to your Claude Desktop config (~/.claude/claude_desktop_config.json):"
echo ""
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cat <<EOF
{
  "mcpServers": {
    "cubase": {
      "command": "node",
      "args": ["$SCRIPT_DIR/src/index.js"]
    }
  }
}
EOF
echo ""

echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Configure IAC Driver (if not already done)"
echo "  2. Open Cubase 13 Pro"
echo "  3. Go to Studio > MIDI Remote Manager"
echo "  4. Find 'Claude MCP Bridge' and connect its MIDI In/Out to the IAC Driver buses"
echo "  5. Restart Claude Desktop to load the MCP server"
echo "  6. Use 'cubase_connect' tool to establish the connection"
