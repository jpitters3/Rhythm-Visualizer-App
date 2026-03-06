import { saveCompositionLocal, saveAudioClip } from './audio-storage.js';
import { serializePattern } from './pattern-crud.js';

class CompositionManager {
  constructor() {
    this.activeComposition = null;
  }

  /**
   * Initializes a brand new composition
   */
  startNewComposition() {
    const timestamp = new Date().toLocaleString();
    this.activeComposition = {
      id: `comp_${Date.now()}`,
      title: `Composition ${timestamp}`,
      createdAt: Date.now(),
      steps: []
    };
    return this.activeComposition;
  }

  /**
   * Gets the active composition, or creates one if it doesn't exist
   */
  getActiveComposition() {
    if (!this.activeComposition) {
      return this.startNewComposition();
    }
    return this.activeComposition;
  }

  /**
   * Auto-saves the currently exported grid pattern into the specified step
   * @param {number} stepIndex - The 1-based step index
   */
  async autoSaveStepPattern(stepIndex) {
    const comp = this.getActiveComposition();
    const arrayIndex = stepIndex - 1;

    // Ensure array is large enough
    while (comp.steps.length <= arrayIndex) {
      comp.steps.push({ pattern: null, audioId: null });
    }

    comp.steps[arrayIndex].pattern = serializePattern();
    await saveCompositionLocal(comp.id, comp);
  }

  /**
   * Saves a raw audio blob to IndexedDB and links it to the active composition step
   * @param {number} stepIndex - The 1-based step index
   * @param {Blob} blob - The raw WebM audio blob
   */
  async autoSaveStepAudio(stepIndex, blob) {
    const comp = this.getActiveComposition();
    const arrayIndex = stepIndex - 1;

    // Ensure array is large enough
    while (comp.steps.length <= arrayIndex) {
      comp.steps.push({ pattern: null, audioId: null });
    }

    const audioId = `${comp.id}_step${stepIndex}_audio_${Date.now()}`;
    await saveAudioClip(audioId, blob);

    comp.steps[arrayIndex].audioId = audioId;
    await saveCompositionLocal(comp.id, comp);
  }
}

export const compositionManager = new CompositionManager();
