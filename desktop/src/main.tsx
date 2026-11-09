import { render } from 'preact';

function App() {
  return (
    <main>
      <h1>OMP</h1>
      <p>Desktop-версия</p>
    </main>
  );
}

render(<App />, document.getElementById('app')!);
