import { h, render } from 'preact';
import { App } from './App';
import './editor.css';

render(h(App, {}), document.getElementById('app')!);
