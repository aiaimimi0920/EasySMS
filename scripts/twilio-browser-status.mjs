const port = Number.parseInt(process.argv[2] ?? "9223", 10);

if (!Number.isFinite(port) || port <= 0) {
  throw new Error(`Invalid remote debugging port: ${process.argv[2] ?? ""}`);
}

const versionResponse = await fetch(`http://127.0.0.1:${port}/json/version`);
if (!versionResponse.ok) {
  throw new Error(`Failed to query /json/version from port ${port}: ${versionResponse.status}`);
}

const listResponse = await fetch(`http://127.0.0.1:${port}/json/list`);
if (!listResponse.ok) {
  throw new Error(`Failed to query /json/list from port ${port}: ${listResponse.status}`);
}

const version = await versionResponse.json();
const pages = await listResponse.json();

console.log(JSON.stringify({
  port,
  version,
  pages,
}, null, 2));
