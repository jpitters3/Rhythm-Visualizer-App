/**
 * js/audio-storage.js
 * Handles saving and loading of raw audio clips using IndexedDB
 * to preserve local storage space and bypass typical quota limits.
 */

const DB_NAME = 'GroovePanAudioDB';
const DB_VERSION = 2;
const STORE_NAME = 'audioClips';
const COMPOSITIONS_STORE = 'compositions';

let dbPromise = null;

function initDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(COMPOSITIONS_STORE)) {
        db.createObjectStore(COMPOSITIONS_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });

  return dbPromise;
}

/**
 * Saves an audio blob to IndexedDB
 * @param {string} id - unique identifier for the clip (e.g. 'motif', 'verseA')
 * @param {Blob} blob - the audio data
 * @returns {Promise<void>}
 */
export async function saveAudioClip(id, blob) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put({ id, blob, timestamp: Date.now() });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Retrieves an audio blob from IndexedDB
 * @param {string} id 
 * @returns {Promise<Blob|null>}
 */
export async function getAudioClip(id) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result ? request.result.blob : null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Deletes an audio clip from IndexedDB
 * @param {string} id 
 * @returns {Promise<void>}
 */
export async function deleteAudioClip(id) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Saves a full composition object to IndexedDB
 * @param {string} id - unique identifier (e.g. timestamp title)
 * @param {Object} compositionData - the full composition array
 * @returns {Promise<void>}
 */
export async function saveCompositionLocal(id, compositionData) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(COMPOSITIONS_STORE, 'readwrite');
    const store = tx.objectStore(COMPOSITIONS_STORE);
    const request = store.put({ id, data: compositionData, updated_at: Date.now() });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Retrieves a full composition by ID
 * @param {string} id 
 * @returns {Promise<Object|null>}
 */
export async function getCompositionLocal(id) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(COMPOSITIONS_STORE, 'readonly');
    const store = tx.objectStore(COMPOSITIONS_STORE);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result ? request.result.data : null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Retrieves all saved composition objects
 * @returns {Promise<Array<Object>>}
 */
export async function getAllCompositionsLocal() {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(COMPOSITIONS_STORE, 'readonly');
    const store = tx.objectStore(COMPOSITIONS_STORE);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}