import type { CodegenConfig } from '@graphql-codegen/cli'

/**
 * GraphQL Code Generator Configuration
 *
 * Generates TypeScript types and React Apollo hooks from GraphQL schema and operations.
 * Follows Uniswap's codegen pattern for type-safe GraphQL queries.
 *
 * Run with: npx graphql-codegen
 *
 * @see interface/packages/api/src/clients/graphql/codegen.config.ts
 */
const config: CodegenConfig = {
  overwrite: true,
  schema: 'lib/apollo/schema/schema.graphql',
  documents: ['lib/apollo/queries/**/*.graphql', 'lib/apollo/queries/**/*.ts'],
  generates: {
    // 1. Schema types - standalone TypeScript types from GraphQL schema
    'lib/apollo/__generated__/schema-types.ts': {
      plugins: ['typescript'],
      config: {
        maybeValue: 'T | undefined',
        enumsAsTypes: true,
        scalars: {
          BigInt: 'string',
        },
      },
    },
    // 2. Operations - types for queries/mutations (imports from schema-types)
    'lib/apollo/__generated__/operations.ts': {
      preset: 'import-types',
      presetConfig: {
        typesPath: './schema-types',
      },
      plugins: ['typescript-operations'],
      config: {
        maybeValue: 'T | undefined',
        preResolveTypes: false,
        scalars: {
          BigInt: 'string',
        },
      },
    },
    // 3. React Apollo hooks - auto-generated hooks for queries/mutations (imports from both)
    'lib/apollo/__generated__/react-hooks.ts': {
      preset: 'import-types',
      presetConfig: {
        typesPath: './operations',
      },
      plugins: ['typescript-react-apollo'],
      config: {
        withHooks: true,
        withHOC: false,
        withComponent: false,
        maybeValue: 'T | undefined',
        scalars: {
          BigInt: 'string',
        },
        importOperationTypesFrom: './operations',
      },
    },
  },
}

export default config
