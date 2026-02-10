/**
 * Coaching Diagnostics
 * Analyzes patterns in coaching session data to provide actionable advice
 * on physical setup, calibration, and timing.
 */

export class CoachingDiagnostics {
  constructor() {
    this.events = [];
    this.noteStats = {}; // { 'D': { hits: 0, total: 0 }, ... }
    this.timingDiffs = [];
    this.recentLoudNotes = []; // Track recent loud inputs for masking detection
  }

  /**
   * Record an evaluation event
   * @param {Object} data 
   */
  record(data) {
    const {
      stepIndex,
      expected,    // array of labels expected
      detected,    // string detected
      correct,
      timingError, // absolute error
      timingOffset, // signed error (actual - expected), if available
      previousNote // { label: 'D', time: 12345 } 
    } = data;

    this.events.push(data);

    // Update Note Stats
    expected.forEach(noteLabel => {
      if (!this.noteStats[noteLabel]) {
        this.noteStats[noteLabel] = { hits: 0, total: 0, sequentialMisses: 0 };
      }
      this.noteStats[noteLabel].total++;
      if (correct) {
        this.noteStats[noteLabel].hits++;
        this.noteStats[noteLabel].sequentialMisses = 0;
      } else {
        this.noteStats[noteLabel].sequentialMisses++;
      }
    });

    // Store signed timing offset if we can derive it
    // The coaching mode currently calculates absolute error, let's assume valid timing for now
    // or we need to update coaching-mode to pass signed offset.
    if (correct && timingError !== undefined) {
      // We'll trust the error magnitude for consistency checks
      this.timingDiffs.push(timingError);
    }
  }

  /**
   * Analyze session data and return suggestions
   * @returns {Array} Array of strings (suggestions)
   */
  analyze() {
    const suggestions = [];

    // 1. Check for Dead Zones / Calibration Issues
    // Rule: Note has < 30% accuracy while overall accuracy > 50%
    // Or: Note missed 3 times in a row consistently
    Object.entries(this.noteStats).forEach(([label, stats]) => {
      if (stats.total >= 3) {
        const accuracy = stats.hits / stats.total;
        if (accuracy < 0.3) {
          suggestions.push(`I'm having trouble hearing your '${label}'. Try rotating your handpan or recalibrating that note.`);
        }
      }
    });

    // 2. Check for "Sustain Masking" (The "Close Note" issue)
    // This is harder to detect post-hoc without signal data, but we can infer:
    // If we consistently miss a note that follows a SPECIFIC other note.
    // e.g. every time we expect '1' after 'D', we miss '1'.
    const transitionMisses = this.analyzeTransitions();
    if (transitionMisses.length > 0) {
      const worst = transitionMisses[0];
      if (worst.from == worst.to) {
        suggestions.push(`The note '${worst.from}' is being missed many times in a row. Try recalibrating that note.`);
      } else {
        suggestions.push(`The sustain from '${worst.from}' might be hiding '${worst.to}'. Try moving your microphone further away or more central.`);
      }
    }

    // 3. Timing Drift (Consistency)
    // If timing error is consistently large even on "correct" notes
    // (Note: we need signed offset to detect 'Early' vs 'Late'. 
    // For now, if avg error is > 80ms, we suggest calibration)
    if (this.timingDiffs.length > 5) {
      const avgError = this.timingDiffs.reduce((a, b) => a + b, 0) / this.timingDiffs.length;
      if (avgError > 80) {
        suggestions.push(`Your timing is consistently a bit off (${Math.round(avgError)}ms). Try running the Audio Latency calibration in Settings.`);
      }
    }

    return suggestions;
  }

  /**
   * Detect if we consistently miss a note X when it follows note Y
   */
  analyzeTransitions() {
    // Map: "D->1" : { total: 0, misses: 0 }
    const transitions = {};

    // We need to look at the expected sequence
    // We can reconstruct loosely from the events array if it's ordered
    for (let i = 1; i < this.events.length; i++) {
      const prev = this.events[i - 1];
      const curr = this.events[i];

      // If time difference corresponds to a fast transition (< 400ms)
      // This is a rough heuristic

      const prevLabel = prev.expected[0];
      const currLabel = curr.expected[0];

      if (prevLabel && currLabel) {
        const key = `${prevLabel}->${currLabel}`;
        if (!transitions[key]) transitions[key] = { total: 0, misses: 0 };

        transitions[key].total++;
        if (!curr.correct) {
          transitions[key].misses++;
        }
      }
    }

    const problems = [];
    Object.entries(transitions).forEach(([key, stats]) => {
      if (stats.total >= 3 && (stats.misses / stats.total) > 0.6) {
        const [from, to] = key.split('->');
        problems.push({ from, to, accuracy: 1 - (stats.misses / stats.total) });
      }
    });

    return problems;
  }
}
