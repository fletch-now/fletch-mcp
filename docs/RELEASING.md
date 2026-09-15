# Publishing fletch-mcp

`fletch-mcp` is prepared at version `0.3.2`. The npm registry returned 404 for
this package on 15 September 2026; publication remains pending. The GitHub
command in the README remains the working installation path.

## Check the package

From the repository root, use Node 20 or later:

```bash
npm ci --ignore-scripts
npm test
npm run test:package
npm pack
```

`test:package` packs and installs the package in a temporary application, then
runs the local stdio tests against the installed executable. It checks the
tools, resources, credential handling and package license. The installation
resolves runtime dependencies from npm; the test makes no live API requests.
The temporary application is removed when the check finishes.

`npm pack` leaves `fletch-mcp-0.3.2.tgz`. Keep the package version and lockfile in
step and commit the source and release documentation before publishing.

## Publish

The manual `publish MCP` workflow accepts the package version and runs only from
`main`. It checks the source and installed package, then uploads the release
tarball before publishing. The workflow needs a repository secret named
`NPM_TOKEN` with permission to publish `fletch-mcp`; a missing or rejected token
fails the publication step. Repository code does not contain that credential.

For a local release, authenticate with an npm account that can publish the name,
then publish the checked tarball:

```bash
npm login --registry=https://registry.npmjs.org
npm whoami --registry=https://registry.npmjs.org
npm publish ./fletch-mcp-0.3.2.tgz --access public --ignore-scripts --registry=https://registry.npmjs.org
npm view fletch-mcp@0.3.2 version dist.integrity --registry=https://registry.npmjs.org
```

The workflow requests a provenance statement, which records the source and build
identity. See [npm's provenance documentation](https://docs.npmjs.com/generating-provenance-statements/).
Local publishing does not produce that workflow attestation.

After npm confirms the version, run `npx -y fletch-mcp@0.3.2` from a fresh MCP
client configuration and check its tools. Then update the README command and
JSON configuration to use that published version. A successful test or uploaded
tarball does not establish that the npm release exists.
