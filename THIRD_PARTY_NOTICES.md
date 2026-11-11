# Third-Party Notices

## Perseus Digital Library

Chora displays Plato text supplied at runtime by PlatoSI. Chora does not include a copy of the Perseus corpus.

Repository: `PerseusDL/canonical-greekLit`

## License

PlatoSI supplies the source and licensing metadata shown by Chora. Consult PlatoSI's corpus manifest and the upstream Perseus files for the revision and license applicable to each work.

## Optional interlocutor integration

- `@agentclientprotocol/sdk` 1.5.0 — Apache-2.0, [ACP TypeScript SDK](https://github.com/agentclientprotocol/typescript-sdk).
- `@modelcontextprotocol/sdk` 1.29.0 — MIT, [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).
- Goose 1.59.0 — Apache-2.0, [Goose](https://github.com/aaif-goose/goose). The optional setup script downloads and verifies the upstream Windows binary; Chora does not commit or bundle it.

Dependency packages retain their own license files. Local model weights are
managed separately by Ollama and are not distributed with Chora.
