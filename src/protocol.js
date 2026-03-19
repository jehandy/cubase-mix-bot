/**
 * MIDI Protocol Constants for Cubase MCP Bridge
 *
 * Defines the MIDI channel, CC numbers, and SysEx messages
 * used for communication between the MCP server and the
 * Cubase MIDI Remote script via IAC Driver.
 */

import { createLogger } from './logger.js';

const log = createLogger('protocol');

// All control messages use MIDI Channel 16 (0-indexed: 15)
export const MIDI_CHANNEL = 15;

// IAC Driver port names (configured in macOS Audio MIDI Setup)
export const IAC_PORT_TO_CUBASE = 'IAC Driver Claude MCP Out';
export const IAC_PORT_FROM_CUBASE = 'IAC Driver Claude MCP In';

// --- Transport Controls (CC 110-119) ---
export const CC_TRANSPORT = {
  PLAY:           110,  // 127 = play, 0 = stop
  STOP:           111,  // 127 = trigger stop
  RECORD:         112,  // 127 = record, 0 = stop record
  CYCLE:          113,  // 127 = loop on, 0 = loop off
  REWIND:         114,  // 127 = return to zero
  FORWARD:        115,  // 127 = go to end
  CLICK:          116,  // 127 = metronome on, 0 = off
  LOCATE_LEFT:    117,  // 127 = go to left locator
  LOCATE_RIGHT:   118,  // 127 = go to right locator
};

// --- Navigation (CC 100-109) ---
export const CC_NAV = {
  TRACK_PREV:     100,  // 127 = select previous track
  TRACK_NEXT:     101,  // 127 = select next track
  BANK_PREV:      102,  // 127 = previous bank of 8 channels
  BANK_NEXT:      103,  // 127 = next bank of 8 channels
};

// --- Selected Track Mixer (CC 1-19) ---
export const CC_SELECTED = {
  VOLUME:         1,    // 0-127 mapped to fader range
  PAN:            2,    // 0-127, 64 = center
  MUTE:           3,    // 127 = mute, 0 = unmute
  SOLO:           4,    // 127 = solo, 0 = unsolo
  SEND1_LEVEL:    5,    // 0-127
  SEND2_LEVEL:    6,    // 0-127
  SEND3_LEVEL:    7,    // 0-127
  SEND4_LEVEL:    8,    // 0-127
  SEND1_ON:       9,    // 127/0
  SEND2_ON:       10,   // 127/0
  SEND3_ON:       11,   // 127/0
  SEND4_ON:       12,   // 127/0
  INSERT1_BYPASS: 13,   // 127 = bypass, 0 = active
  INSERT2_BYPASS: 14,
  INSERT3_BYPASS: 15,
  INSERT4_BYPASS: 16,
  EQ_ON:          17,   // 127 = EQ on, 0 = off
  MONITOR:        18,   // 127 = monitor on, 0 = off
  RECORD_ENABLE:  19,   // 127 = arm, 0 = disarm
};

// --- Bank Channel Volumes (CC 20-27) for 8-channel bank ---
export const CC_BANK_VOLUME = [20, 21, 22, 23, 24, 25, 26, 27];
export const CC_BANK_PAN    = [28, 29, 30, 31, 32, 33, 34, 35];
export const CC_BANK_MUTE   = [36, 37, 38, 39, 40, 41, 42, 43];
export const CC_BANK_SOLO   = [44, 45, 46, 47, 48, 49, 50, 51];

// --- Quick Controls (CC 52-59) for selected track ---
export const CC_QUICK_CONTROLS = [52, 53, 54, 55, 56, 57, 58, 59];

// --- Focused Quick Controls (CC 60-67) - auto-maps to open/focused plugin ---
export const CC_FOCUSED_QC = [60, 61, 62, 63, 64, 65, 66, 67];

// --- Feedback from Cubase (same CCs echoed back on output) ---
// The Cubase MIDI Remote script will send back current values
// on the same CC numbers via the output port.

// --- SysEx for string data (track names, project info) ---
// SysEx manufacturer ID (non-commercial): 0x7D
const SYSEX_HEADER = [0xF0, 0x7D, 0x43, 0x4D]; // F0 7D "CM"

export const SYSEX_MSG = {
  // Auto-push from Cubase script (no request needed)
  SELECTED_TRACK_NAME:  0x10,  // Sent whenever selected track changes
  BANK_CHANNEL_NAME:    0x11,  // Sent for each bank channel on bank change (byte 0 = channel 0-7)
};

// Helper to build a SysEx message
export function buildSysEx(msgType, data = []) {
  log.debug(`buildSysEx type=0x${msgType.toString(16)} dataLen=${data.length}`);
  return [...SYSEX_HEADER, msgType, ...data, 0xF7];
}

// Helper to parse a SysEx response
export function parseSysEx(bytes) {
  if (bytes[0] !== 0xF0 || bytes[1] !== 0x7D || bytes[2] !== 0x43 || bytes[3] !== 0x4D) {
    return null;
  }
  const msgType = bytes[4];
  const data = bytes.slice(5, -1); // exclude F7
  log.debug(`parseSysEx type=0x${msgType.toString(16)} dataLen=${data.length}`);
  return { msgType, data };
}

// Convert 7-bit SysEx bytes back to string
export function sysExBytesToString(bytes) {
  return String.fromCharCode(...bytes);
}
