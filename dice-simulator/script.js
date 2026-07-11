const dice = [document.querySelector('#die-one'), document.querySelector('#die-two')];
const rollButton = document.querySelector('#roll-button');
const total = document.querySelector('#total');
const result = document.querySelector('#result');

// Opposite pairs are structurally fixed: 1–6, 2–5, 3–4.
const faces = [
  ['front', 1], ['back', 6], ['right', 2],
  ['left', 5], ['top', 3], ['bottom', 4]
];
const pipPositions = {
  1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9]
};
const orientations = {
  1: 'rotateX(90deg)', 2: 'rotateZ(-90deg)', 3: 'rotateX(0deg)',
  4: 'rotateX(180deg)', 5: 'rotateZ(90deg)', 6: 'rotateX(-90deg)'
};

function buildCube(cube) {
  faces.forEach(([side, value]) => {
    const face = document.createElement('div');
    face.className = `face ${side}`;
    face.dataset.face = value;
    pipPositions[value].forEach((position) => {
      const pip = document.createElement('span');
      pip.className = `pip p${position}`;
      face.appendChild(pip);
    });
    cube.appendChild(face);
  });
}

function randomFace() { return Math.floor(Math.random() * 6) + 1; }

function setTopFaces(values) {
  dice.forEach((cube, index) => {
    cube.style.setProperty('--orientation', orientations[values[index]]);
    cube.dataset.top = values[index];
    cube.setAttribute('aria-label', `${index === 0 ? '첫 번째' : '두 번째'} 주사위 윗면: ${values[index]}`);
  });
}

function rollDice() {
  if (rollButton.disabled) return;
  rollButton.disabled = true;
  rollButton.querySelector('span').textContent = '굴리는 중...';
  result.classList.remove('pop');
  total.textContent = '—';
  const finalValues = [randomFace(), randomFace()];
  setTopFaces(finalValues);
  dice.forEach((cube) => cube.classList.add('rolling'));

  window.setTimeout(() => {
    dice.forEach((cube) => cube.classList.remove('rolling'));
    total.textContent = finalValues[0] + finalValues[1];
    result.classList.add('pop');
    rollButton.disabled = false;
    rollButton.querySelector('span').textContent = '다시 굴리기';
    rollButton.focus();
  }, 1400);
}

dice.forEach(buildCube);
setTopFaces([3, 4]);
rollButton.addEventListener('click', rollDice);
document.addEventListener('keydown', (event) => {
  if (event.code === 'Space' && event.target === document.body) {
    event.preventDefault();
    rollDice();
  }
});
