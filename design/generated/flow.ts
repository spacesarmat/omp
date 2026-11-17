import type { FlowDocument } from '../schema.ts';

// Generated from design/flows. The export step rewrites this file with the reviewed
// flow document; a document without rules keeps the production runtime a no-op.
export const PRODUCTION_FLOW: FlowDocument = {
  "schemaVersion": 1,
  "id": "desktop-default",
  "baseCommit": "ec4c646aba58e56c096d713992757fa77e732d04",
  "rules": [
    {
      "id": "nav-library",
      "screenId": "*",
      "elementId": "nav-library",
      "event": "click",
      "action": {
        "type": "navigate",
        "screenId": "library"
      }
    },
    {
      "id": "nav-news",
      "screenId": "*",
      "elementId": "nav-news",
      "event": "click",
      "action": {
        "type": "navigate",
        "screenId": "news"
      }
    },
    {
      "id": "nav-search",
      "screenId": "*",
      "elementId": "nav-search",
      "event": "click",
      "action": {
        "type": "navigate",
        "screenId": "search"
      }
    },
    {
      "id": "nav-remote",
      "screenId": "*",
      "elementId": "nav-remote",
      "event": "click",
      "action": {
        "type": "navigate",
        "screenId": "remote"
      }
    },
    {
      "id": "nav-settings",
      "screenId": "*",
      "elementId": "nav-settings",
      "event": "click",
      "action": {
        "type": "navigate",
        "screenId": "settings"
      }
    },
    {
      "id": "settings-continue-connected",
      "screenId": "settings",
      "elementId": "settings-continue",
      "event": "click",
      "action": {
        "type": "navigate",
        "screenId": "library"
      },
      "condition": {
        "kind": "eq",
        "path": "server.connected",
        "value": true
      }
    },
    {
      "id": "settings-continue-disconnected",
      "screenId": "settings",
      "elementId": "settings-continue",
      "event": "click",
      "action": {
        "type": "navigate",
        "screenId": "connect"
      },
      "condition": {
        "kind": "eq",
        "path": "server.connected",
        "value": false
      }
    }
  ]
};
