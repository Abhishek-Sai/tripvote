import { useEffect, useState } from 'react';

export default function App() {
  const [status, setStatus] = useState('Checking API…');

  useEffect(() => {
    fetch('/api/health')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((body) =>
        setStatus(
          `API connected. Database ${body.databaseConfigured ? 'configured' : 'not configured'}.`,
        ),
      )
      .catch(() => setStatus('API unreachable.'));
  }, []);

  return (
    <main>
      <h1>TripVote</h1>
      <p>Decide where to go, together.</p>
      <p role="status">{status}</p>
    </main>
  );
}
