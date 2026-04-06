// Import CSS
import './css/layout.css';
import './css/controls.css';
import './css/theme.css';
import './css/grid-and-labels.css';
import './css/hand-icons.css';
import './css/legend.css';
import './css/dual-grid.css';
import './css/modal.css';
import './css/song-library.css';
import './css/transport-controls.css';
import './css/presentation-mode.css';
import './css/handpanmap.css';
import './css/handpan-overlays.css';
import './css/hand-cursors.css';
import './css/shared-pattern-banner.css';
import './css/action-bar.css';
import './css/measure-actions.css';
import './css/course-creator.css';
import './css/courses.css';
import './css/mic-mode.css';
import './css/ai-assistant.css';
import './css/profile.css';
import './css/feed.css';
import './css/course-marketplace.css';
import './css/calibration.css';
import './css/error.css';
import './css/pattern-of-the-week.css';
import './css/games.css';
import './css/calibration.css';
import './css/compose-wizard.css';
import './css/glossary.css';
import './css/assignments.css';

// Import JS (Ordered Dependencies)
// Using raw imports for side-effect scripts that populate 'window'
// import './js/supabase-config.js'; // Removed: File does not exist
// import './js/constants.js'; // Removed: File does not exist

// Core Logic
import './js/alert.js';
import './js/rhythm-core.js';
import './js/grid-context.js';
import './js/transport-ui.js';
import './js/range-selection.js';
import './js/measure-actions.js';
import './js/notegrid.js';
import './js/noteplayer.js';
import './js/handpanmap.js';
import './js/virtual-hands.js';
import './js/compose-mode.js';
import './js/transcription.js';
import './js/audio-storage.js';
import './js/audio-recorder.js';
import './js/compose-wizard.js';
import './js/groove-generator.js';
import './js/presentation-mode.js';
import './js/pattern-crud.js';
import './js/controls.js';
import './js/share-patterns.js';
import './js/keyboard-shortcuts.js';
import './js/profile.js';
import './js/auth.js';
import './js/course-creator.js';
import './js/courses.js';
import './js/history.js';
import './js/chord-analyzer.js';
import './js/chord-ui.js';

// Initialization
// Note: init.js is deferred in HTML, but here it runs last in the bundle which is correct.
import './js/init.js';

// Features
import './js/ai-assistant.js';
import './js/feed.js';
import './js/community-posts.js';
import './js/course-marketplace.js';
import './js/calibration.js';
import './js/practice.js';
import './js/mobile-menu.js';
import './js/pattern-of-the-week.js';
import './js/midi-importer.js';
import './js/song-library.js';
import './js/games.js';
import './css/song-composer.css';
import './js/song-composer.js';
import './css/admin.css'; // Admin Styles
import './js/admin.js';   // Admin Logic
import './js/assignments.js';
