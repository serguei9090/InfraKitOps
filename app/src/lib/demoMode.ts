/**
 * Demo build flag. Set `VITE_DEMO_MODE=1` at build time (the GitHub Pages
 * workflow does) to mark this as the public, client-only demo: the 88 offline
 * tools work, and the backend-driven modules show a "download the app" card
 * instead of a dev-setup snippet.
 *
 * A user can still point the demo at their own backend via
 * Settings → Backend → Endpoint override; that keeps working.
 */
export const DEMO_MODE =
  import.meta.env.VITE_DEMO_MODE === '1' || import.meta.env.VITE_DEMO_MODE === 'true'

export const REPO_URL = 'https://github.com/serguei9090/InfraKitOps'
export const RELEASES_URL = `${REPO_URL}/releases/latest`
export const DEPLOY_DOCS_URL = `${REPO_URL}/blob/main/docs/deployment/DEPLOY.md`
export const DOCKER_ONELINER =
  'docker run -p 8080:8080 -v infrakit:/data ghcr.io/serguei9090/infrakitops:latest'
