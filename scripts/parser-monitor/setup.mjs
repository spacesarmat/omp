// The live monitor runs in Node (real fetch, real timeouts); the parsers only need DOMParser, taken from jsdom.
import { JSDOM } from 'jsdom';

if (!globalThis.DOMParser) globalThis.DOMParser = new JSDOM('').window.DOMParser;
