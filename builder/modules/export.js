import { getElements } from './elements.js';

export async function exportProject(projectName = 'MyWatchFace') {
  const elements = getElements();
  const res = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ elements, projectName }),
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
}

export async function previewInSimulator() {
  const elements = getElements();
  const res = await fetch('/api/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ elements, projectName: 'WatchFacePreview' }),
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
}
