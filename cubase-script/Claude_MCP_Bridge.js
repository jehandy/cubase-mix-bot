/**
 * Cubase MIDI Remote Script - Claude MCP Bridge
 *
 * Install to:
 *   ~/Documents/Steinberg/Cubase/MIDI Remote/Driver Scripts/Local/Claude/MCP_Bridge/
 *   File must be named: Claude_MCP_Bridge.js
 *
 * Requires: Cubase 13 Pro with MIDI Remote API v1
 */

//----------------------------------------------------------------------------------------------------------------------
// 1. DRIVER SETUP
//----------------------------------------------------------------------------------------------------------------------

var midiremote_api = require('midiremote_api_v1')

var deviceDriver = midiremote_api.makeDeviceDriver('Claude', 'MCP Bridge', 'Anthropic')

var midiInput  = deviceDriver.mPorts.makeMidiInput()
var midiOutput = deviceDriver.mPorts.makeMidiOutput()

// No auto-detection needed - this device is manually assigned to IAC Driver in MIDI Remote Manager

var CH = 15  // MIDI Channel 16 (0-indexed)

var surface = deviceDriver.mSurface

// ============================================================
// Transport Buttons
// ============================================================
var btnPlay       = surface.makeButton(0, 0, 1, 1)
var btnStop       = surface.makeButton(1, 0, 1, 1)
var btnRecord     = surface.makeButton(2, 0, 1, 1)
var btnCycle      = surface.makeButton(3, 0, 1, 1)
var btnRewind     = surface.makeButton(4, 0, 1, 1)
var btnForward    = surface.makeButton(5, 0, 1, 1)
var btnClick      = surface.makeButton(6, 0, 1, 1)
var btnLocLeft    = surface.makeButton(7, 0, 1, 1)
var btnLocRight   = surface.makeButton(8, 0, 1, 1)

btnPlay.mSurfaceValue.mMidiBinding.setInputPort(midiInput).setOutputPort(midiOutput).bindToControlChange(CH, 110)
btnStop.mSurfaceValue.mMidiBinding.setInputPort(midiInput).setOutputPort(midiOutput).bindToControlChange(CH, 111)
btnRecord.mSurfaceValue.mMidiBinding.setInputPort(midiInput).setOutputPort(midiOutput).bindToControlChange(CH, 112)
btnCycle.mSurfaceValue.mMidiBinding.setInputPort(midiInput).setOutputPort(midiOutput).bindToControlChange(CH, 113)
btnRewind.mSurfaceValue.mMidiBinding.setInputPort(midiInput).bindToControlChange(CH, 114)
btnForward.mSurfaceValue.mMidiBinding.setInputPort(midiInput).bindToControlChange(CH, 115)
btnClick.mSurfaceValue.mMidiBinding.setInputPort(midiInput).setOutputPort(midiOutput).bindToControlChange(CH, 116)
btnLocLeft.mSurfaceValue.mMidiBinding.setInputPort(midiInput).bindToControlChange(CH, 117)
btnLocRight.mSurfaceValue.mMidiBinding.setInputPort(midiInput).bindToControlChange(CH, 118)

// ============================================================
// Navigation Buttons
// ============================================================
var btnTrackPrev = surface.makeButton(0, 1, 1, 1)
var btnTrackNext = surface.makeButton(1, 1, 1, 1)
var btnBankPrev  = surface.makeButton(2, 1, 1, 1)
var btnBankNext  = surface.makeButton(3, 1, 1, 1)

btnTrackPrev.mSurfaceValue.mMidiBinding.setInputPort(midiInput).bindToControlChange(CH, 100)
btnTrackNext.mSurfaceValue.mMidiBinding.setInputPort(midiInput).bindToControlChange(CH, 101)
btnBankPrev.mSurfaceValue.mMidiBinding.setInputPort(midiInput).bindToControlChange(CH, 102)
btnBankNext.mSurfaceValue.mMidiBinding.setInputPort(midiInput).bindToControlChange(CH, 103)

// ============================================================
// Selected Track Controls
// ============================================================
var selVolume    = surface.makeFader(0, 2, 1, 3)
var selPan       = surface.makeKnob(1, 2, 1, 1)
var selMute      = surface.makeButton(2, 2, 1, 1)
var selSolo      = surface.makeButton(3, 2, 1, 1)
var selMonitor   = surface.makeButton(4, 2, 1, 1)
var selRecEnable = surface.makeButton(5, 2, 1, 1)
var selEQ        = surface.makeButton(6, 2, 1, 1)

selVolume.mSurfaceValue.mMidiBinding.setInputPort(midiInput).setOutputPort(midiOutput).bindToControlChange(CH, 1)
selPan.mSurfaceValue.mMidiBinding.setInputPort(midiInput).setOutputPort(midiOutput).bindToControlChange(CH, 2)
selMute.mSurfaceValue.mMidiBinding.setInputPort(midiInput).setOutputPort(midiOutput).bindToControlChange(CH, 3)
selSolo.mSurfaceValue.mMidiBinding.setInputPort(midiInput).setOutputPort(midiOutput).bindToControlChange(CH, 4)
selMonitor.mSurfaceValue.mMidiBinding.setInputPort(midiInput).setOutputPort(midiOutput).bindToControlChange(CH, 18)
selRecEnable.mSurfaceValue.mMidiBinding.setInputPort(midiInput).setOutputPort(midiOutput).bindToControlChange(CH, 19)
selEQ.mSurfaceValue.mMidiBinding.setInputPort(midiInput).setOutputPort(midiOutput).bindToControlChange(CH, 17)

// ============================================================
// Selected Track Sends (1-4)
// ============================================================
var selSendLevel = []
var selSendOn = []
for (var i = 0; i < 4; i++) {
  selSendLevel[i] = surface.makeKnob(i, 3, 1, 1)
  selSendOn[i] = surface.makeButton(i + 4, 3, 1, 1)
  selSendLevel[i].mSurfaceValue.mMidiBinding.setInputPort(midiInput).setOutputPort(midiOutput).bindToControlChange(CH, 5 + i)
  selSendOn[i].mSurfaceValue.mMidiBinding.setInputPort(midiInput).setOutputPort(midiOutput).bindToControlChange(CH, 9 + i)
}

// ============================================================
// Selected Track Insert Bypass (1-4)
// ============================================================
var selInsertBypass = []
for (var i = 0; i < 4; i++) {
  selInsertBypass[i] = surface.makeButton(i, 4, 1, 1)
  selInsertBypass[i].mSurfaceValue.mMidiBinding.setInputPort(midiInput).setOutputPort(midiOutput).bindToControlChange(CH, 13 + i)
}

// ============================================================
// Selected Track Quick Controls (8 knobs, CC 52-59)
// ============================================================
var selQC = []
for (var i = 0; i < 8; i++) {
  selQC[i] = surface.makeKnob(i, 11, 1, 1)
  selQC[i].mSurfaceValue.mMidiBinding.setInputPort(midiInput).setOutputPort(midiOutput).bindToControlChange(CH, 52 + i)
}

// ============================================================
// Focused Quick Controls (8 knobs, CC 60-67)
// Controls whatever plugin is currently focused/open
// ============================================================
var focusQC = []
for (var i = 0; i < 8; i++) {
  focusQC[i] = surface.makeKnob(i, 12, 1, 1)
  focusQC[i].mSurfaceValue.mMidiBinding.setInputPort(midiInput).setOutputPort(midiOutput).bindToControlChange(CH, 60 + i)
}

// ============================================================
// Bank Mixer (8 channels)
// ============================================================
var bankFaders = []
var bankPans   = []
var bankMutes  = []
var bankSolos  = []

for (var i = 0; i < 8; i++) {
  bankFaders[i] = surface.makeFader(i, 5, 1, 3)
  bankPans[i]   = surface.makeKnob(i, 8, 1, 1)
  bankMutes[i]  = surface.makeButton(i, 9, 1, 1)
  bankSolos[i]  = surface.makeButton(i, 10, 1, 1)

  bankFaders[i].mSurfaceValue.mMidiBinding.setInputPort(midiInput).setOutputPort(midiOutput).bindToControlChange(CH, 20 + i)
  bankPans[i].mSurfaceValue.mMidiBinding.setInputPort(midiInput).setOutputPort(midiOutput).bindToControlChange(CH, 28 + i)
  bankMutes[i].mSurfaceValue.mMidiBinding.setInputPort(midiInput).setOutputPort(midiOutput).bindToControlChange(CH, 36 + i)
  bankSolos[i].mSurfaceValue.mMidiBinding.setInputPort(midiInput).setOutputPort(midiOutput).bindToControlChange(CH, 44 + i)
}

// ============================================================
// Host Mapping
// ============================================================
var page = deviceDriver.mMapping.makePage('Claude MCP')

// Transport
page.makeCommandBinding(btnPlay.mSurfaceValue,     'Transport', 'Start')
page.makeCommandBinding(btnStop.mSurfaceValue,      'Transport', 'Stop')
page.makeCommandBinding(btnRecord.mSurfaceValue,    'Transport', 'Record')
page.makeCommandBinding(btnCycle.mSurfaceValue,     'Transport', 'Cycle')
page.makeCommandBinding(btnRewind.mSurfaceValue,    'Transport', 'Return to Zero')
page.makeCommandBinding(btnForward.mSurfaceValue,   'Transport', 'Goto End')
page.makeCommandBinding(btnClick.mSurfaceValue,     'Transport', 'Activate Metronome Click')
page.makeCommandBinding(btnLocLeft.mSurfaceValue,   'Transport', 'Locate Left Locator')
page.makeCommandBinding(btnLocRight.mSurfaceValue,  'Transport', 'Locate Right Locator')

// Navigation
page.makeCommandBinding(btnTrackPrev.mSurfaceValue, 'Navigate', 'Up')
page.makeCommandBinding(btnTrackNext.mSurfaceValue, 'Navigate', 'Down')
page.makeCommandBinding(btnBankPrev.mSurfaceValue,  'Navigate', 'Left')
page.makeCommandBinding(btnBankNext.mSurfaceValue,  'Navigate', 'Right')

// Selected Track
var sel = page.mHostAccess.mTrackSelection.mMixerChannel

var selVolumeBinding = page.makeValueBinding(selVolume.mSurfaceValue, sel.mValue.mVolume)
page.makeValueBinding(selPan.mSurfaceValue,       sel.mValue.mPan)
page.makeValueBinding(selMute.mSurfaceValue,      sel.mValue.mMute)
page.makeValueBinding(selSolo.mSurfaceValue,      sel.mValue.mSolo)
page.makeValueBinding(selMonitor.mSurfaceValue,   sel.mValue.mMonitorEnable)
page.makeValueBinding(selRecEnable.mSurfaceValue, sel.mValue.mRecordEnable)
page.makeValueBinding(selEQ.mSurfaceValue,        sel.mChannelEQ.mBand1.mOn)

// Sends
for (var i = 0; i < 4; i++) {
  page.makeValueBinding(selSendLevel[i].mSurfaceValue, sel.mSends.getByIndex(i).mLevel)
  page.makeValueBinding(selSendOn[i].mSurfaceValue,    sel.mSends.getByIndex(i).mOn)
}

// Insert Bypass - commented out pending correct API path for Cubase 13
// for (var i = 0; i < 4; i++) {
//   page.makeValueBinding(selInsertBypass[i].mSurfaceValue, sel.mInsertAndStripEffects.mInserts.getByIndex(i).mBypass)
// }

// Quick Controls (8 knobs mapped to selected track's Quick Controls)
for (var i = 0; i < 8; i++) {
  page.makeValueBinding(selQC[i].mSurfaceValue, sel.mQuickControls.getByIndex(i))
}

// Focused Quick Controls (auto-maps to whichever plugin is open/focused)
var focusedQCs = page.mHostAccess.mFocusedQuickControls
for (var i = 0; i < 8; i++) {
  page.makeValueBinding(focusQC[i].mSurfaceValue, focusedQCs.getByIndex(i))
}

// Bank Mixer
var bankZone = page.mHostAccess.mMixConsole.makeMixerBankZone()
  .excludeInputChannels()
  .excludeOutputChannels()
  .setFollowVisibility(true)

var bankChannels = []
var bankVolBindings = []
for (var i = 0; i < 8; i++) {
  var ch = bankZone.makeMixerBankChannel()
  bankChannels[i] = ch
  bankVolBindings[i] = page.makeValueBinding(bankFaders[i].mSurfaceValue, ch.mValue.mVolume)
  page.makeValueBinding(bankPans[i].mSurfaceValue,   ch.mValue.mPan)
  page.makeValueBinding(bankMutes[i].mSurfaceValue,  ch.mValue.mMute)
  page.makeValueBinding(bankSolos[i].mSurfaceValue,  ch.mValue.mSolo)
}

// ============================================================
// Track Name SysEx Feedback
// ============================================================
// SysEx format: F0 7D 43 4D [msgType] [data...] F7
// 7D = non-commercial, 43 4D = "CM" (Claude MCP)
// msgType 0x10 = selected track name
// msgType 0x11 = bank channel name (byte0 = channel index, rest = name)

function stringToSysex(str) {
  var bytes = []
  for (var i = 0; i < str.length; i++) {
    bytes.push(str.charCodeAt(i) & 0x7F)
  }
  return bytes
}

function sendSysEx(activeDevice, msgType, data) {
  var msg = [0xF0, 0x7D, 0x43, 0x4D, msgType]
  for (var i = 0; i < data.length; i++) {
    msg.push(data[i])
  }
  msg.push(0xF7)
  midiOutput.sendMidi(activeDevice, msg)
}

// Selected track name: fires whenever the selected track changes
selVolumeBinding.mOnTitleChange = function (activeDevice, activeMapping, title) {
  if (title && title.length > 0) {
    sendSysEx(activeDevice, 0x10, stringToSysex(title))
  }
}

// Bank channel names: fire when the bank scrolls or tracks change
for (var i = 0; i < 8; i++) {
  ;(function(idx) {
    bankVolBindings[idx].mOnTitleChange = function (activeDevice, activeMapping, title) {
      if (title && title.length > 0) {
        var data = [idx]
        var nameBytes = stringToSysex(title)
        for (var j = 0; j < nameBytes.length; j++) {
          data.push(nameBytes[j])
        }
        sendSysEx(activeDevice, 0x11, data)
      }
    }
  })(i)
}
