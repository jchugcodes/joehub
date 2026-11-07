import { loadFixtures } from "../lib/fixtures.mjs";

export default function HomePage() {
  const data = loadFixtures();
  return (
    <main>
      {/* TODO: design handoff — home */}
      <h1>joehub</h1>
      <p>Synthetic fixtures only.</p>
      <ul>
        <li>Finance accounts: {data.accounts.length}</li>
        <li>Job applications: {data.applications.length}</li>
        <li>Journal entries: {data.entries.length}</li>
      </ul>
    </main>
  );
}
