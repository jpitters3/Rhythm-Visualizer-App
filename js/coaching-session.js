
import { activeGrid } from './grid-context.js';
import { CoachingDiagnostics } from './coaching-diagnostics.js';

export class CoachingSession {
  constructor(data) {
    if (!data) {
      this.createNewSession();
      return;
    }

    if (data instanceof CoachingSession) {
      Object.assign(this, data);
      return;
    }

    if (this.isDatabaseRow(data)) {
      this.hydrateFromDB(data);
    }
  }

  isDatabaseRow(data) {
    // Check for characteristic DB columns
    return 'note_results' in data || 'overall_score' in data || 'created_at' in data;
  }

  hydrateFromDB(data) {
    this.id = data.id;
    this.patternName = data.pattern_name;
    this.bpm = data.bpm;
    this.totalNotes = data.total_notes;
    this.correctNotes = data.correct_notes;
    this.noteAccuracy = data.note_accuracy;
    this.timingAccuracy = data.timing_accuracy;
    this.overallScore = data.overall_score;
    this.noteResults = data.note_results || [];
    this.problemMeasures = data.problem_measures || [];

    // Historical sessions don't have live diagnostics or loop observers
    this.diagnostics = null;
    this._loopObserver = null;
    this.isRealSession = true;
    this.createdAt = data.created_at; // Preserve timestamp
  }

  createNewSession() {
    this.id = Date.now();
    this.patternName = activeGrid.patternName || 'Untitled Pattern';
    this.bpm = activeGrid.bpm;
    this.totalNotes = 0;
    this.correctNotes = 0;
    this.noteAccuracy = 0;
    this.timingAccuracy = 0;
    this.overallScore = 0;
    this.startTime = null;
    this.endTime = null;
    this.loopCount = 0;
    this.actualStartTime = null;
    this.noteResults = [];
    this.problemMeasures = [];
    this.diagnostics = new CoachingDiagnostics(activeGrid);
    this._loopObserver = null;
    this.isRealSession = true;
  }
}