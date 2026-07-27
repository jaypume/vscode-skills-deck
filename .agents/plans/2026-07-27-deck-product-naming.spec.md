# Deck Product Naming

## Decision

Use **Deck** as the shared product-family metaphor for small developer tools
that collect, organize, and operate on a set of related items.

The naming pattern is:

| Surface | Pattern | Example |
| --- | --- | --- |
| Product | `<Domain> Deck` | `Skills Deck` |
| Marketplace ID | `pujie.<domain>-deck` | `pujie.skills-deck` |
| Repository | `jaypume/<domain>-deck` | `jaypume/skills-deck` |
| VS Code namespace | `<domain>Deck` | `skillsDeck.*` |
| Settings namespace | `<domain>-deck` | `skills-deck.*` |

Use a plural domain when the product manages a collection: `Skills Deck`,
`Extensions Deck`, `Prompts Deck`, `Agents Deck`, `Tools Deck`.

## Rationale

- **Deck** suggests a curated set of items that can be selected, combined, and
  acted on.
- It is shorter and more extensible as a product family than `Manager`.
- `Vault` overemphasizes security and storage.
- `Shelf` feels passive and does not imply install, update, or sync actions.
- `Stack` is easily confused with a technology stack or call stack.

## Current Product

The current extension is:

- Product: `Skills Deck`
- Marketplace ID: `pujie.skills-deck`
- Repository: `https://github.com/jaypume/skills-deck`
- Command and view namespace: `skillsDeck`
- Settings namespace: `skills-deck`

The extension remains a declarative Agent Skills manager. The rename changes
product identity and integration namespaces, not the domain model:
`SkillRepository`, `DeclaredSkill`, `skillId`, and `repoId` keep their existing
meanings.

## Compatibility

The Marketplace identity changes before the first successful public release.
On activation, Skills Deck copies an existing
`pujie.skills-manager/data.json` into its new global-storage directory when the
new data file does not yet exist.

## Availability Snapshot

As checked on 2026-07-27:

- Marketplace internal ID `skills-deck` had no exact match.
- Marketplace display name `Skills Deck` had no exact match.
- GitHub repository `jaypume/skills-deck` did not exist.

Availability is not a reservation; publishing and repository rename are the
final confirmation.
