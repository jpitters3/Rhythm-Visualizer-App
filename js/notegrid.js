/* ==== Layout and structure of the notes ==== */

const cells = () => document.querySelectorAll('.cell');

function setCols(n) {
  // Apply to the measures wrapper (it cascades to measure children)
  if (measuresEl) measuresEl.style.setProperty('--cols', String(n));
}

function labelForStep(i) {
  if (mode === '8') {
    const beatNumber = Math.floor(i / 2) + 1;
    return (i % 2 === 0) ? String(beatNumber) : '+';
  }
  const beatNumber = Math.floor(i / 4) + 1;
  const pos = i % 4;
  if (pos === 0) return String(beatNumber);
  if (pos === 1) return 'e';
  if (pos === 2) return '&';
  return 'a';
}

function clearGridDom() {
  if (measuresEl) measuresEl.innerHTML = '';
}

function clearSelection() {
  selectedIndex = null;
  cells().forEach(c => c.classList.remove('selected'));
}

function applySelection(i) {
  selectedIndex = i;
  cells().forEach((c, idx) => c.classList.toggle('selected', idx === i));
}

function setInnerLabel(i, value) {
  innerLabels[i] = value;
  const cell = cells()[i];
  if (!cell) return;

  const inner = cell.querySelector('.inner');
  if (inner) inner.textContent = value;

  cell.classList.remove('label-d', 'label-t', 'label-s', 'label-n', 'has-label');
  const v = String(value || '');
  
  // ghost = no label set
  cell.classList.toggle('ghost', !v);

  if (!v) return;
  cell.classList.add('has-label');


    if (v === 'D') cell.classList.add('label-d');
    else if (v === 'T') cell.classList.add('label-t');
    else if (v === 'S') cell.classList.add('label-s');
    else if (/^[0-9]$/.test(v)) cell.classList.add('label-n');

}

function buildGrid() {
  clearGridDom();
  setCols(STEPS);

  const totalSteps = measures * STEPS;

  // Preserve existing data when changing measures
  const prevLabels = innerLabels.slice();

  innerLabels = Array(totalSteps).fill('');
  for (let i = 0; i < Math.min(prevLabels.length, totalSteps); i++) innerLabels[i] = String(prevLabels[i] || '');

  selectedIndex = null;
  step = 0;

  for (let m = 0; m < measures; m++) {
    const measureWrap = document.createElement('div');
    measureWrap.className = 'measure';

    for (let i = 0; i < STEPS; i++) {
      const globalIndex = (m * STEPS) + i;

      // Labels row (row 1)
      const label = document.createElement('div');
      label.className = 'labelCell';
      label.textContent = labelForStep(i);
      measureWrap.appendChild(label);

      // Grid row (row 2)
      const cell = document.createElement('div');
      cell.className = 'cell gridCell';

      // Default: unlabeled = ghost
      cell.classList.add('ghost');

      // Assign hand + beat position classes (same logic you already had, but using local step i)
      if (mode === '8') {
        const isDown = (i % 2 === 0);
        cell.classList.add(isDown ? 'hand-r' : 'hand-l');
        cell.classList.add(isDown ? 'downbeat' : 'upbeat');
      } else {
        const pos = i % 4;
        const isDown = (pos === 0);
        cell.classList.add((pos === 0 || pos === 2) ? 'hand-r' : 'hand-l');
        cell.classList.add(isDown ? 'downbeat' : 'upbeat');
      }

      const inner = document.createElement('div');
      inner.className = 'inner';
      inner.textContent = '';
      cell.appendChild(inner);

      // Ghost note dot
      const ghost = document.createElement('div');
      ghost.className = 'ghost-dot';
      cell.appendChild(ghost);

      cell.addEventListener('click', (ev) => {
        ev.stopPropagation();

        // Click selects (Esc clears selection)
        if (selectedIndex === globalIndex) clearSelection();
        else applySelection(globalIndex);
      });

      measureWrap.appendChild(cell);
    }

    // Show +Add Measure button ONLY on last measure
    const addBtn = document.createElement('button');
    const existingAddBtn = document.getElementById('add-measure');

    if (m === measures - 1) {
      addBtn.id = 'add-measure';
      addBtn.className = 'add-measure';
      addBtn.type = 'button';
      addBtn.title = 'Add another measure';
      addBtn.style = 'width: 200px'
      addBtn.textContent = '+ Add Measure';
      addBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        addMeasure();
      });

      if (existingAddBtn) existingAddBtn.remove();
      measuresEl.after(addBtn);
    }

    measuresEl.appendChild(measureWrap);
  }

  // Apply labels after DOM exists
  for (let i = 0; i < totalSteps; i++) {
    if (innerLabels[i]) setInnerLabel(i, innerLabels[i]);
  }
}

function addMeasure() {
  measures += 1;
  buildGrid();
  restartIfPlaying();
}