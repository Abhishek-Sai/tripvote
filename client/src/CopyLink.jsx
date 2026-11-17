import { useState } from 'react';

export default function CopyLink({ label, path }) {
  const [status, setStatus] = useState('');
  const link = new URL(path, window.location.origin).href;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setStatus('Link copied.');
    } catch {
      setStatus('Select the link and copy it manually.');
    }
  }

  return (
    <div className="copy-link">
      <label>{label}<input readOnly value={link} onFocus={(event) => event.target.select()} /></label>
      <button type="button" className="secondary" onClick={copy} aria-label={'Copy ' + label.toLowerCase()}>Copy</button>
      {status && <div className="hint copy-status" role="status">{status}</div>}
    </div>
  );
}
