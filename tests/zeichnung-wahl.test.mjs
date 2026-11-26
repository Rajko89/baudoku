import test from 'node:test';
import assert from 'node:assert/strict';
import { zeichnungBeschriftung, speicherArt } from '../js/draw.js';

test('ohne vorhandene Kopie wird direkt ein neues Foto angelegt', () => {
  assert.equal(speicherArt(false), 'anlegen');
  assert.equal(speicherArt(true), 'fragen');
});

test('Beschriftung setzt Zeichnung nur einmal davor', () => {
  assert.equal(zeichnungBeschriftung(''), 'Zeichnung');
  assert.equal(zeichnungBeschriftung('Nordseite'), 'Zeichnung: Nordseite');
  assert.equal(zeichnungBeschriftung('Zeichnung'), 'Zeichnung');
  assert.equal(zeichnungBeschriftung('Zeichnung: Nordseite'), 'Zeichnung: Nordseite');
});
