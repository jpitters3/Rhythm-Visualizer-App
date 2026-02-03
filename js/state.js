/**
 * Global State Management
 */

// Initial State
// These were previously in index.html
export let innerLabels = [];
export let measures = 1;

// Global Grid Instances
// These will be initialized here instead of grid-context.js
// to avoid circular dependency issues if grid-context needs to import things
export let gridA = null;
export let gridB = null;
export let activeGrid = null;

export const setGridA = (g) => { gridA = g; };
export const setGridB = (g) => { gridB = g; };
export const setActiveGrid = (g) => { activeGrid = g; };

export const getGridA = () => gridA;
export const getGridB = () => gridB;
export const getActiveGrid = () => activeGrid;
