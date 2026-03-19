#!/usr/bin/env node

/**
 * Cubase MCP Server
 *
 * Exposes tools for controlling Cubase 13 Pro via MIDI Remote API,
 * and analyzing audio mixdowns for mix quality assessment.
 *
 * Communication: MCP Server <-> IAC Driver (MIDI) <-> Cubase MIDI Remote Script
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import bridge from './midi-bridge.js';
import { analyzeAudioFile } from './audio-analyzer.js';
import { createLogger } from './logger.js';

const log = createLogger('mcp-server');
import {
  CC_TRANSPORT,
  CC_QUICK_CONTROLS,
  CC_FOCUSED_QC,
  CC_NAV,
  CC_SELECTED,
  CC_BANK_VOLUME,
  CC_BANK_PAN,
  CC_BANK_MUTE,
  CC_BANK_SOLO,
  SYSEX_MSG,
} from './protocol.js';

// --- Tool Definitions ---

const TOOLS = [
  // === Connection ===
  {
    name: 'cubase_connect',
    description: 'Connect to Cubase via IAC Driver MIDI ports. Must be called before any other Cubase control tool.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'cubase_status',
    description: 'Get current connection status and last known mixer/transport values from Cubase feedback.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // === Transport ===
  {
    name: 'cubase_transport',
    description: 'Control Cubase transport: play, stop, record, toggle loop, return to zero, toggle metronome click.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['play', 'stop', 'record', 'toggle_loop', 'rewind', 'forward', 'toggle_click', 'goto_left_locator', 'goto_right_locator'],
          description: 'Transport action to perform',
        },
      },
      required: ['action'],
    },
  },

  // === Track Navigation ===
  {
    name: 'cubase_select_track',
    description: 'Navigate track selection in Cubase. Move to previous/next track or bank of 8 tracks.',
    inputSchema: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['previous', 'next', 'bank_previous', 'bank_next'],
          description: 'Direction to navigate tracks',
        },
      },
      required: ['direction'],
    },
  },

  // === Selected Track Mixer ===
  {
    name: 'cubase_set_volume',
    description: 'Set the volume fader of the currently selected track in Cubase. Value 0-127 (100 ≈ 0dB unity gain, 0 = -∞).',
    inputSchema: {
      type: 'object',
      properties: {
        value: {
          type: 'number',
          minimum: 0,
          maximum: 127,
          description: 'Fader value 0-127 (100 ≈ 0dB)',
        },
      },
      required: ['value'],
    },
  },
  {
    name: 'cubase_set_pan',
    description: 'Set the pan position of the currently selected track. 0 = full left, 64 = center, 127 = full right.',
    inputSchema: {
      type: 'object',
      properties: {
        value: {
          type: 'number',
          minimum: 0,
          maximum: 127,
          description: 'Pan position 0-127 (64 = center)',
        },
      },
      required: ['value'],
    },
  },
  {
    name: 'cubase_toggle_mute',
    description: 'Mute or unmute the currently selected track in Cubase.',
    inputSchema: {
      type: 'object',
      properties: {
        mute: {
          type: 'boolean',
          description: 'true = mute, false = unmute',
        },
      },
      required: ['mute'],
    },
  },
  {
    name: 'cubase_toggle_solo',
    description: 'Solo or unsolo the currently selected track in Cubase.',
    inputSchema: {
      type: 'object',
      properties: {
        solo: {
          type: 'boolean',
          description: 'true = solo, false = unsolo',
        },
      },
      required: ['solo'],
    },
  },
  {
    name: 'cubase_set_send',
    description: 'Set the send level (1-4) on the currently selected track. Useful for controlling reverb/delay send amounts.',
    inputSchema: {
      type: 'object',
      properties: {
        sendNumber: {
          type: 'number',
          minimum: 1,
          maximum: 4,
          description: 'Send slot number (1-4)',
        },
        level: {
          type: 'number',
          minimum: 0,
          maximum: 127,
          description: 'Send level 0-127',
        },
        enabled: {
          type: 'boolean',
          description: 'Enable/disable the send (optional)',
        },
      },
      required: ['sendNumber', 'level'],
    },
  },
  {
    name: 'cubase_bypass_insert',
    description: 'Bypass or activate an insert plugin slot (1-4) on the currently selected track.',
    inputSchema: {
      type: 'object',
      properties: {
        slot: {
          type: 'number',
          minimum: 1,
          maximum: 4,
          description: 'Insert slot number (1-4)',
        },
        bypass: {
          type: 'boolean',
          description: 'true = bypass, false = activate',
        },
      },
      required: ['slot', 'bypass'],
    },
  },
  {
    name: 'cubase_toggle_eq',
    description: 'Enable or disable the channel EQ on the currently selected track.',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description: 'true = enable EQ, false = disable',
        },
      },
      required: ['enabled'],
    },
  },
  {
    name: 'cubase_record_enable',
    description: 'Arm or disarm the currently selected track for recording.',
    inputSchema: {
      type: 'object',
      properties: {
        armed: {
          type: 'boolean',
          description: 'true = arm for recording, false = disarm',
        },
      },
      required: ['armed'],
    },
  },
  {
    name: 'cubase_monitor',
    description: 'Enable or disable input monitoring on the currently selected track.',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description: 'true = monitor on, false = monitor off',
        },
      },
      required: ['enabled'],
    },
  },

  // === Bank Mixer (control 8 channels at once) ===
  {
    name: 'cubase_bank_mixer',
    description: 'Set volume, pan, mute, or solo for a specific channel in the current 8-channel bank. Use cubase_select_track with bank_previous/bank_next to change which 8 channels are active.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: {
          type: 'number',
          minimum: 1,
          maximum: 8,
          description: 'Channel number within the bank (1-8)',
        },
        parameter: {
          type: 'string',
          enum: ['volume', 'pan', 'mute', 'solo'],
          description: 'Which parameter to control',
        },
        value: {
          type: 'number',
          minimum: 0,
          maximum: 127,
          description: 'Value to set (0-127 for volume/pan, 0 or 127 for mute/solo)',
        },
      },
      required: ['channel', 'parameter', 'value'],
    },
  },

  // === Audio Analysis ===
  {
    name: 'analyze_mixdown',
    description: 'Analyze an exported WAV audio file for mix quality. Performs frequency spectrum analysis, loudness/dynamics measurement, stereo width assessment, clipping detection, and generates actionable mixing suggestions. Use this on exported mixdowns from Cubase.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute path to the WAV file to analyze',
        },
      },
      required: ['filePath'],
    },
  },

  // === Quick Controls ===
  {
    name: 'cubase_set_quick_control',
    description: 'Set a Quick Control value (1-8) on the currently selected track. Quick Controls can be assigned to any plugin parameter in Cubase (EQ gain, compressor threshold, etc.), giving indirect control over any effect parameter. The user must first assign the Quick Control to the desired parameter in Cubase.',
    inputSchema: {
      type: 'object',
      properties: {
        slot: {
          type: 'number',
          minimum: 1,
          maximum: 8,
          description: 'Quick Control slot number (1-8)',
        },
        value: {
          type: 'number',
          minimum: 0,
          maximum: 127,
          description: 'Value to set (0-127)',
        },
      },
      required: ['slot', 'value'],
    },
  },

  // === Track Identification ===
  {
    name: 'cubase_get_selected_track',
    description: 'Get the name of the currently selected track in Cubase. The track name is automatically reported by Cubase whenever the selection changes.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'cubase_get_bank_names',
    description: 'Get the names of all 8 channels in the current mixer bank. Useful for understanding which tracks are visible and navigable.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'cubase_select_track_by_name',
    description: 'Navigate to a track by name. Searches forward through tracks until the target is found or the list wraps. Uses the auto-reported track name from Cubase for confirmation. Maximum 60 steps to prevent infinite loops.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Track name to search for (case-insensitive partial match)',
        },
        maxSteps: {
          type: 'number',
          minimum: 1,
          maximum: 120,
          description: 'Maximum navigation steps before giving up (default: 60)',
        },
      },
      required: ['name'],
    },
  },

  // === Focused Quick Controls ===
  {
    name: 'cubase_set_focused_qc',
    description: 'Set a Focused Quick Control value (1-8). These automatically map to whatever plugin window is currently open/focused in Cubase. No pre-assignment needed — just open any plugin and these controls map to its parameters. Works across any project.',
    inputSchema: {
      type: 'object',
      properties: {
        slot: {
          type: 'number',
          minimum: 1,
          maximum: 8,
          description: 'Focused Quick Control slot number (1-8)',
        },
        value: {
          type: 'number',
          minimum: 0,
          maximum: 127,
          description: 'Value to set (0-127)',
        },
      },
      required: ['slot', 'value'],
    },
  },
];

// --- Tool Handlers ---

async function handleTool(name, args) {
  log.info(`Tool call: ${name} args=${JSON.stringify(args)}`);
  switch (name) {
    // --- Connection ---
    case 'cubase_connect': {
      const success = await bridge.connect();
      if (success) {
        return { content: [{ type: 'text', text: 'Successfully connected to Cubase via IAC Driver MIDI ports. Ready to send commands.' }] };
      } else {
        return {
          content: [{
            type: 'text',
            text: 'Failed to connect to IAC Driver. Please ensure:\n1. IAC Driver is enabled in Audio MIDI Setup\n2. Two buses are configured: "Claude MCP Out" and "Claude MCP In"\n3. The Cubase MIDI Remote script is installed and active\n\nSee README.md for setup instructions.'
          }],
          isError: true,
        };
      }
    }

    case 'cubase_status': {
      const status = bridge.getStatus();
      return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
    }

    // --- Transport ---
    case 'cubase_transport': {
      const ccMap = {
        play:               [CC_TRANSPORT.PLAY, 127],
        stop:               [CC_TRANSPORT.STOP, 127],
        record:             [CC_TRANSPORT.RECORD, 127],
        toggle_loop:        [CC_TRANSPORT.CYCLE, 127],
        rewind:             [CC_TRANSPORT.REWIND, 127],
        forward:            [CC_TRANSPORT.FORWARD, 127],
        toggle_click:       [CC_TRANSPORT.CLICK, 127],
        goto_left_locator:  [CC_TRANSPORT.LOCATE_LEFT, 127],
        goto_right_locator: [CC_TRANSPORT.LOCATE_RIGHT, 127],
      };
      const [cc, val] = ccMap[args.action];
      bridge.sendCC(cc, val);
      return { content: [{ type: 'text', text: `Transport: ${args.action} sent to Cubase.` }] };
    }

    // --- Navigation ---
    case 'cubase_select_track': {
      const navMap = {
        previous:      CC_NAV.TRACK_PREV,
        next:          CC_NAV.TRACK_NEXT,
        bank_previous: CC_NAV.BANK_PREV,
        bank_next:     CC_NAV.BANK_NEXT,
      };
      bridge.sendCC(navMap[args.direction], 127);
      return { content: [{ type: 'text', text: `Navigation: ${args.direction} sent to Cubase.` }] };
    }

    // --- Selected Track Mixer ---
    case 'cubase_set_volume': {
      bridge.sendCC(CC_SELECTED.VOLUME, args.value);
      return { content: [{ type: 'text', text: `Selected track volume set to ${args.value}/127.` }] };
    }

    case 'cubase_set_pan': {
      bridge.sendCC(CC_SELECTED.PAN, args.value);
      const panLabel = args.value === 64 ? 'center' : args.value < 64 ? `${64 - args.value}L` : `${args.value - 64}R`;
      return { content: [{ type: 'text', text: `Selected track pan set to ${panLabel} (${args.value}/127).` }] };
    }

    case 'cubase_toggle_mute': {
      bridge.sendCC(CC_SELECTED.MUTE, args.mute ? 127 : 0);
      return { content: [{ type: 'text', text: `Selected track ${args.mute ? 'muted' : 'unmuted'}.` }] };
    }

    case 'cubase_toggle_solo': {
      bridge.sendCC(CC_SELECTED.SOLO, args.solo ? 127 : 0);
      return { content: [{ type: 'text', text: `Selected track ${args.solo ? 'soloed' : 'unsoloed'}.` }] };
    }

    case 'cubase_set_send': {
      const levelCCs = [CC_SELECTED.SEND1_LEVEL, CC_SELECTED.SEND2_LEVEL, CC_SELECTED.SEND3_LEVEL, CC_SELECTED.SEND4_LEVEL];
      const onCCs = [CC_SELECTED.SEND1_ON, CC_SELECTED.SEND2_ON, CC_SELECTED.SEND3_ON, CC_SELECTED.SEND4_ON];
      const idx = args.sendNumber - 1;

      bridge.sendCC(levelCCs[idx], args.level);
      if (args.enabled !== undefined) {
        bridge.sendCC(onCCs[idx], args.enabled ? 127 : 0);
      }
      return { content: [{ type: 'text', text: `Send ${args.sendNumber} level set to ${args.level}/127${args.enabled !== undefined ? `, ${args.enabled ? 'enabled' : 'disabled'}` : ''}.` }] };
    }

    case 'cubase_bypass_insert': {
      const bypassCCs = [CC_SELECTED.INSERT1_BYPASS, CC_SELECTED.INSERT2_BYPASS, CC_SELECTED.INSERT3_BYPASS, CC_SELECTED.INSERT4_BYPASS];
      bridge.sendCC(bypassCCs[args.slot - 1], args.bypass ? 127 : 0);
      return { content: [{ type: 'text', text: `Insert slot ${args.slot} ${args.bypass ? 'bypassed' : 'activated'}.` }] };
    }

    case 'cubase_toggle_eq': {
      bridge.sendCC(CC_SELECTED.EQ_ON, args.enabled ? 127 : 0);
      return { content: [{ type: 'text', text: `Channel EQ ${args.enabled ? 'enabled' : 'disabled'}.` }] };
    }

    case 'cubase_record_enable': {
      bridge.sendCC(CC_SELECTED.RECORD_ENABLE, args.armed ? 127 : 0);
      return { content: [{ type: 'text', text: `Track recording ${args.armed ? 'armed' : 'disarmed'}.` }] };
    }

    case 'cubase_monitor': {
      bridge.sendCC(CC_SELECTED.MONITOR, args.enabled ? 127 : 0);
      return { content: [{ type: 'text', text: `Input monitoring ${args.enabled ? 'enabled' : 'disabled'}.` }] };
    }

    // --- Bank Mixer ---
    case 'cubase_bank_mixer': {
      const idx = args.channel - 1;
      const ccArrays = {
        volume: CC_BANK_VOLUME,
        pan:    CC_BANK_PAN,
        mute:   CC_BANK_MUTE,
        solo:   CC_BANK_SOLO,
      };
      bridge.sendCC(ccArrays[args.parameter][idx], args.value);
      return { content: [{ type: 'text', text: `Bank channel ${args.channel} ${args.parameter} set to ${args.value}.` }] };
    }

    // --- Audio Analysis ---
    case 'analyze_mixdown': {
      try {
        const results = analyzeAudioFile(args.filePath);
        const report = formatAnalysisReport(results);
        return { content: [{ type: 'text', text: report }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Audio analysis error: ${err.message}` }],
          isError: true,
        };
      }
    }

    // --- Track Identification ---
    case 'cubase_get_selected_track': {
      const trackName = bridge.selectedTrackName || '(unknown - navigate to a track first)';
      return { content: [{ type: 'text', text: `Selected track: ${trackName}` }] };
    }

    case 'cubase_get_bank_names': {
      const names = bridge.bankChannelNames;
      const lines = [];
      for (let i = 0; i < 8; i++) {
        lines.push(`  Ch ${i + 1}: ${names[i] || '(empty)'}`);
      }
      return { content: [{ type: 'text', text: `Current bank channels:\n${lines.join('\n')}` }] };
    }

    case 'cubase_select_track_by_name': {
      const target = args.name.toLowerCase();
      const maxSteps = args.maxSteps || 60;

      // Check if already on target
      if (bridge.selectedTrackName && bridge.selectedTrackName.toLowerCase().includes(target)) {
        return { content: [{ type: 'text', text: `Already on track: ${bridge.selectedTrackName}` }] };
      }

      // Navigate forward, checking after each step
      let found = false;
      let steps = 0;
      const visited = new Set();

      for (let i = 0; i < maxSteps; i++) {
        bridge.sendCC(CC_NAV.TRACK_NEXT, 127);
        steps++;

        // Wait briefly for Cubase to send back the new track name
        await new Promise(resolve => setTimeout(resolve, 80));

        const current = bridge.selectedTrackName || '';
        if (current.toLowerCase().includes(target)) {
          found = true;
          break;
        }

        // Detect if we've looped (same name seen again)
        if (visited.has(current) && visited.size > 3) {
          break;
        }
        visited.add(current);
      }

      if (found) {
        return { content: [{ type: 'text', text: `Found and selected: ${bridge.selectedTrackName} (after ${steps} steps)` }] };
      } else {
        return {
          content: [{ type: 'text', text: `Track "${args.name}" not found after ${steps} steps. Last track seen: ${bridge.selectedTrackName || '(unknown)'}. Try checking the exact track name with cubase_get_bank_names.` }],
          isError: true,
        };
      }
    }

    // --- Quick Controls ---
    case 'cubase_set_quick_control': {
      const ccIdx = args.slot - 1;
      bridge.sendCC(CC_QUICK_CONTROLS[ccIdx], args.value);
      const currentFeedback = bridge.getFeedback(CC_QUICK_CONTROLS[ccIdx]);
      return { content: [{ type: 'text', text: `Quick Control ${args.slot} set to ${args.value}/127.${currentFeedback !== null ? ` (previous: ${currentFeedback})` : ''}` }] };
    }

    case 'cubase_set_focused_qc': {
      const ccIdx = args.slot - 1;
      bridge.sendCC(CC_FOCUSED_QC[ccIdx], args.value);
      const currentFeedback = bridge.getFeedback(CC_FOCUSED_QC[ccIdx]);
      return { content: [{ type: 'text', text: `Focused Quick Control ${args.slot} set to ${args.value}/127.${currentFeedback !== null ? ` (previous: ${currentFeedback})` : ''}` }] };
    }

    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
}

/**
 * Format analysis results into a readable report
 */
function formatAnalysisReport(results) {
  const lines = [];

  lines.push('# Audio Mixdown Analysis Report\n');

  // Format
  const f = results.format;
  lines.push(`## File Info`);
  lines.push(`- Duration: ${f.duration_display} (${f.duration_seconds}s)`);
  lines.push(`- Format: ${f.bitDepth}-bit / ${f.sampleRate}Hz / ${f.channels}ch\n`);

  // Dynamics
  const d = results.dynamics;
  lines.push(`## Dynamics`);
  lines.push(`- Peak Level: ${d.peakLevel_dB} dBFS`);
  lines.push(`- RMS Level: ${d.rmsLevel_dB} dBFS`);
  lines.push(`- Crest Factor: ${d.crestFactor_dB} dB`);
  lines.push(`- Dynamic Range: ${d.dynamicRange_dB} dB`);
  lines.push(`- Estimated Loudness: ~${d.estimatedLUFS} LUFS\n`);

  // Clipping
  const c = results.clipping;
  lines.push(`## Clipping Detection`);
  lines.push(`- Clipped Samples: ${c.clippedSamples} (${c.clippedPercent}%)`);
  lines.push(`- Status: ${c.hasClipping ? '⚠️ CLIPPING DETECTED' : '✅ No clipping'}\n`);

  // Spectrum
  lines.push(`## Frequency Spectrum`);
  for (const band of results.spectrum) {
    const bar = '█'.repeat(Math.max(0, Math.round((band.level_dB + 60) / 2)));
    lines.push(`- ${band.name.padEnd(10)} (${band.range.padEnd(14)}): ${band.level_dB.toString().padStart(6)} dB  ${bar}`);
  }
  lines.push('');

  // Stereo
  if (results.stereo) {
    const s = results.stereo;
    lines.push(`## Stereo Image`);
    lines.push(`- Correlation: ${s.correlation} (1.0 = mono, 0 = uncorrelated, -1 = out of phase)`);
    lines.push(`- Width Ratio (side/mid): ${s.widthRatio}`);
    lines.push(`- L/R Balance: ${s.balance_dB > 0 ? '+' : ''}${s.balance_dB} dB (${Math.abs(s.balance_dB) < 0.5 ? 'centered' : s.balance_dB > 0 ? 'right-heavy' : 'left-heavy'})`);
    lines.push(`- Mid Level: ${s.midLevel_dB} dB | Side Level: ${s.sideLevel_dB} dB\n`);
  }

  // Suggestions
  lines.push(`## Mixing Suggestions`);
  for (const sug of results.suggestions) {
    const icon = sug.severity === 'error' ? '🔴' : sug.severity === 'warning' ? '🟡' : '🔵';
    lines.push(`${icon} **[${sug.category}]** ${sug.message}`);
  }

  return lines.join('\n');
}

// --- Server Setup ---

const server = new Server(
  { name: 'cubase-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await handleTool(name, args || {});
    if (result.isError) {
      log.error(`Tool ${name} returned error: ${result.content?.[0]?.text}`);
    }
    return result;
  } catch (err) {
    log.error(`Tool ${name} threw: ${err.stack || err.message}`);
    throw err;
  }
});

// Start
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info('Server started. Waiting for commands...');
}

main().catch((err) => {
  log.error(`Fatal error: ${err.stack || err.message}`);
  process.exit(1);
});
