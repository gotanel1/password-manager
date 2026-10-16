import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import assert from "node:assert/strict"

async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? files(join(dir, entry.name)) : join(dir, entry.name)))).flat()
}
const paths = await files("dist")
const scripts = paths.filter((path) => path.endsWith(".js"))
assert(scripts.length > 0, "Build output is missing JavaScript")
for (const path of scripts) {
  const source = await readFile(path, "utf8")
  for (const marker of ["__mockDb", "mock.db", "mock.session", "http://127.0.0.1:1", "secret-must-not-be-exposed"]) {
    assert(!source.includes(marker), `Unexpected development/secret marker in ${path}`)
  }
}
assert(!paths.some((path) => path.endsWith(".map")), "Production source maps must remain disabled")
console.log("Production bundle: no mock markers, no test secret marker, no source maps")
