# Cubase MCP Bridge

An MCP (Model Context Protocol) server that lets Claude control **Cubase 13 Pro** via the MIDI Remote API. Communicates over macOS IAC Driver MIDI ports.

## What It Can Do

### Transport Control
Play, stop, record, toggle loop, rewind to start, toggle metronome click, go to locators.

### Mixer Control (Selected Track)
Volume, pan, mute, solo, send levels (1–4), insert bypass (1–4), channel EQ on/off, monitor enable, record arm.

### Bank Mixer (8 Channels)
Control volume, pan, mute, and solo for 8 channels at once. Navigate banks to access all tracks.

### Audio Analysis
Analyze exported WAV mixdowns for: frequency spectrum, loudness (estimated LUFS), dynamics/crest factor, stereo width & correlation, clipping detection. Generates actionable mixing suggestions.

---

## Requirements

- **macOS** (uses IAC Driver for virtual MIDI)
- **Cubase 13 Pro** (MIDI Remote API v1)
- **Node.js 18+**
- **Claude Desktop** or **Claude Code**

---

## Setup

### 1. Enable IAC Driver

1. Open **Audio MIDI Setup** (Applications → Utilities)
2. Go to **Window → Show MIDI Studio**
3. Double-click **IAC Driver**
4. Check **"Device is online"**
5. Click the **+** button to add two buses:
   - `Claude MCP Out` (sends MIDI from MCP server to Cubase)
   - `Claude MCP In` (receives MIDI feedback from Cubase)
6. Click **Apply**

> **Tip:** If you only see one default IAC bus, that works too — the MCP server will auto-detect any IAC port.

### 2. Install the MCP Server

```bash
cd cubase-mcp
chmod +x setup.sh
./setup.sh
```

Or manually:

```bash
npm install
# Copy MIDI Remote script to Cubase
mkdir -p ~/Documents/Steinberg/Cubase/MIDI\ Remote/Driver\ Scripts/Local/claude_mcp/
cp cubase-script/claude_mcp.js ~/Documents/Steinberg/Cubase/MIDI\ Remote/Driver\ Scripts/Local/claude_mcp/
```

### 3. Configure in Cubase

1. Open (or restart) **Cubase 13 Pro**
2. Go to **Studio → MIDI Remote Manager**
3. You should see **"Claude MCP Bridge"** listed as a device
4. Click to configure and assign:
   - **MIDI Input:** `IAC Driver Claude MCP Out`
   - **MIDI Output:** `IAC Driver Claude MCP In`
5. Ensure the **"Claude MCP"** mapping page is active

### 4. Add to Claude Desktop Config

Add this to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "cubase": {
      "command": "node",
      "args": ["/full/path/to/cubase-mcp/src/index.js"]
    }
  }
}
```

Replace `/full/path/to/` with the actual path to this project.

### 5. Restart Claude Desktop

Restart Claude Desktop to load the MCP server. Then use the `cubase_connect` tool to establish the MIDI connection.

---

## Usage Examples

Once connected, you can ask Claude things like:

- "Play the project" → uses `cubase_transport` (play)
- "Solo the kick drum track" → navigate to track, then solo
- "Set the vocal volume to 0dB" → `cubase_set_volume` (value ~100)
- "Pan the guitar 30% to the left" → `cubase_set_pan` (value ~45)
- "Bypass the compressor on insert 1" → `cubase_bypass_insert`
- "Analyze my mixdown at ~/Desktop/mix.wav" → `analyze_mixdown`

### Audio Analysis

Export a mixdown from Cubase (File → Export → Audio Mixdown) as a WAV file, then:

```
Analyze this mixdown and suggest improvements: /path/to/mixdown.wav
```

The analyzer checks frequency balance, dynamics, stereo image, clipping, and loudness standards, then provides specific mixing suggestions.

---

## Architecture

```
┌──────────────┐     MIDI (IAC Driver)     ┌──────────────┐
│  Claude MCP  │ ──── CC/SysEx messages ──→ │   Cubase 13  │
│   Server     │ ←── Feedback values ────── │  MIDI Remote  │
│  (Node.js)   │                            │    Script     │
└──────────────┘                            └──────────────┘
       ↕ MCP Protocol (stdio)
┌──────────────┐
│ Claude       │
│ Desktop/Code │
└──────────────┘
```

## MIDI Protocol Reference

All messages use **MIDI Channel 16**.

| CC Range | Function |
|----------|----------|
| 1–19 | Selected track: volume, pan, mute, solo, sends, inserts, EQ, monitor, rec |
| 20–51 | Bank channels (8x): volume, pan, mute, solo |
| 100–103 | Navigation: track prev/next, bank prev/next |
| 110–118 | Transport: play, stop, record, loop, rewind, forward, click, locators |

---

## Limitations

- **Track names/project info:** Limited read-back. The MIDI Remote API is primarily designed for control surfaces, not querying project metadata.
- **Plugin parameters:** Can bypass inserts 1–4 but cannot read or set individual plugin parameters through this bridge.
- **Audio analysis:** Requires an exported WAV file — cannot analyze audio in real-time from Cubase's output bus directly.
- **Track count:** Bank mixer provides access to 8 channels at a time; navigate banks to reach all tracks.

---

## Troubleshooting

**"No IAC Driver port found"**
→ Enable IAC Driver in Audio MIDI Setup and add at least one bus.

**"Claude MCP Bridge" doesn't appear in Cubase**
→ Verify the script is in the correct path: `~/Documents/Steinberg/Cubase/MIDI Remote/Driver Scripts/Local/claude_mcp/claude_mcp.js`

**Commands don't affect Cubase**
→ Check that the MIDI Remote device's input port is set to the correct IAC bus in Studio → MIDI Remote Manager.

**No feedback values**
→ Ensure the MIDI Remote device's output port is set to the IAC bus the MCP server reads from.
