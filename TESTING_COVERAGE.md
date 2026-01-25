# Testing & Functionality Checklist

This document tracks the verification status of all application features.
Mark items as:
- `[x]` **Verified**: Covered by automated verification or manual confirmation.
- `[ ]` **Untested**: Needs verification.
- `[!]` **Known Issue**: Feature is currently broken or deferred.

---

## Core Editing & Grid
- [x] **Note Entry**: Clicking cells to cycle D/T/S/Rest (`grid_mechanics.spec.js`)
- [x] **Range Selection**: Shift+Click to select blocks (`grid_mechanics.spec.js`)
- [x] **Copy / Paste**: Cmd+C / Cmd+V for note patterns (`grid_mechanics.spec.js`)
- [x] **Multi-Edit (Chords)**: Double-click cell, select sub-dots, enter notes (`chords.spec.js`)
- [x] **Undo / Redo**: History stack validation (`undo_redo.spec.js`)
- [x] **Measure Actions**: Add/Delete Measure (Verified `measure_actions.spec.js`)

## Playback & Audio
- [x] **Transport**: Play / Stop buttons (`playback.spec.js`)
- [x] **BPM Control**: Slider updates tempo (`playback.spec.js`)
- [x] **Metronome**: Toggle click usage (`playback.spec.js`)
- [x] **Time Signature**: Dynamic numerator/denominator handling (`playback.spec.js`)
- [x] **Looping**: Playback loops correctly (`playback.spec.js`)
- [x] **Sample Loading**: Audio assets load without error (`playback.spec.js`)

## Data & Management
- [x] **Save Pattern**: Create and persist to LocalStorage (`saving_loading.spec.js`)
- [x] **Load Pattern**: Retrieve from list (`saving_loading.spec.js`)
- [x] **Delete Pattern**: Remove from persistent storage (`saving_loading.spec.js`)
- [x] **Data Loss Prevention**: "Unsaved Changes" warnings (`undo_redo.spec.js`)
- [x] **Export / Import**: JSON file handling (Verified cross-browser with clipboard prefs)
- [ ] **Share Pattern**: Copy link / URL generation

## Visualization (Handpan Map)
- [x] **Note Highlight**: Dots light up during playback (`chords.spec.js`)
- [ ] **Hand Sticking**: "R" / "L" indicators visual feedback
- [x] **Sample Loading**: Audio assets load correctly (Fixed `noteplayer.js` default scale)

## Cloud & Community
- [x] **Authentication**: Sign Up / Login / Logout (Verified via `courses.spec.js` mocks)
- [ ] **Profile**: Update username/bio
- [ ] **Community Feed**: View public patterns
- [ ] **Likes**: Like/Unlike patterns

## Education & Courses
- [x] **Course Library**: View list of courses (`courses.spec.js`)
- [x] **Lesson View**: Step-through lessons (Verified via Course Creator tests)
- [ ] **Progress**: "Mark Complete" persistence
- [ ] **Daily Practice**: Playlist management

## Advanced Tools
- [ ] **Transcription**: Audio-to-Grid (Microphone)
- [ ] **Calibration**: Guided latency/sensitivity setup
- [ ] **Presentation Mode**: Full-screen view (`presentation-mode.js`)
- [ ] **AI Assistant**: Chat interface / Groove generation

## Layout & Responsive
- [x] **Desktop View**: Standard layout functionality (All Tests)
- [x] **Mobile View**: Menu navigation and scaling verified (`saving_loading.spec.js` mobile project)

---

**Last Updated**: 2026-01-24
