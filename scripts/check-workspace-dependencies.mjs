#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'

const repoRoot = path.resolve(import.meta.dirname, '..')
const sourceExtensions = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx', '.vue'])
const ignoredDirectories = new Set([
  '.docs',
  '.git',
  'coverage',
  'dist',
  'dist-cli-web',
  'dist-web-wasm',
  'node_modules',
  'out',
  'target',
])
const ignoredPaths = new Set([
  path.join(repoRoot, 'apps', 'desktop', 'native'),
  path.join(repoRoot, 'docs', '.vitepress', 'cache'),
])

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function findWorkspaceManifests() {
  const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const result = spawnSync(pnpmCommand, ['-r', 'list', '--depth', '-1', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`Failed to list pnpm workspace projects: ${result.stderr.trim()}`)
  }
  return JSON.parse(result.stdout).map((project) => path.join(project.path, 'package.json'))
}

function parseModuleSpecifiers(sourceText, filePath) {
  const scriptKind = filePath.endsWith('.tsx') || filePath.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind)
  const specifiers = new Set()

  function addStringLiteral(node) {
    if (node && ts.isStringLiteralLike(node)) specifiers.add(node.text)
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addStringLiteral(node.moduleSpecifier)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      addStringLiteral(node.moduleReference.expression)
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require'
      if (isDynamicImport || isRequire) addStringLiteral(node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return specifiers
}

function extractModuleSpecifiers(filePath) {
  const sourceText = fs.readFileSync(filePath, 'utf8')
  if (!filePath.endsWith('.vue')) return parseModuleSpecifiers(sourceText, filePath)

  const specifiers = new Set()
  const scriptBlockPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi
  for (const match of sourceText.matchAll(scriptBlockPattern)) {
    for (const specifier of parseModuleSpecifiers(match[1], filePath)) specifiers.add(specifier)
  }
  return specifiers
}

function collectSourceFiles(projectRoot, nestedProjectRoots) {
  const files = []

  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name) || ignoredPaths.has(child) || nestedProjectRoots.has(child)) continue
        walk(child)
      } else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
        files.push(child)
      }
    }
  }

  walk(projectRoot)
  return files
}

function resolveWorkspacePackage(specifier, workspaceNames) {
  return workspaceNames.find((name) => specifier === name || specifier.startsWith(`${name}/`))
}

function collectDeclaredDependencies(manifest) {
  return new Map(
    ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].flatMap((field) =>
      Object.entries(manifest[field] ?? {}).map(([name, version]) => [name, { field, version }])
    )
  )
}

function relativePath(filePath) {
  return path.relative(repoRoot, filePath) || '.'
}

function auditWorkspaceDependencies() {
  const projects = findWorkspaceManifests().map((manifestPath) => ({
    manifestPath,
    root: path.dirname(manifestPath),
    manifest: readJson(manifestPath),
  }))
  const workspaceNames = projects
    .map((project) => project.manifest.name)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  const projectRoots = new Set(projects.map((project) => project.root))
  const missing = []
  const invalidProtocols = []

  for (const project of projects) {
    const declared = collectDeclaredDependencies(project.manifest)
    const nestedProjectRoots = new Set(
      [...projectRoots].filter((root) => root !== project.root && root.startsWith(`${project.root}${path.sep}`))
    )
    const references = new Map()

    for (const filePath of collectSourceFiles(project.root, nestedProjectRoots)) {
      for (const specifier of extractModuleSpecifiers(filePath)) {
        const dependency = resolveWorkspacePackage(specifier, workspaceNames)
        if (!dependency || dependency === project.manifest.name) continue
        const files = references.get(dependency) ?? new Set()
        files.add(relativePath(filePath))
        references.set(dependency, files)
      }
    }

    for (const [dependency, files] of references) {
      if (!declared.has(dependency)) {
        missing.push({ project: project.manifest.name, dependency, files: [...files].sort() })
      }
    }

    for (const [dependency, declaration] of declared) {
      if (!workspaceNames.includes(dependency)) continue
      if (declaration.version !== 'workspace:*') {
        invalidProtocols.push({
          project: project.manifest.name,
          dependency,
          field: declaration.field,
          version: declaration.version,
        })
      }
    }
  }

  return { projects, missing, invalidProtocols }
}

const result = auditWorkspaceDependencies()

if (result.missing.length === 0 && result.invalidProtocols.length === 0) {
  console.log(
    `[workspace-deps] Checked ${result.projects.length} projects; all direct workspace dependencies are declared.`
  )
  process.exit(0)
}

for (const issue of result.missing) {
  console.error(`[workspace-deps] ${issue.project} imports ${issue.dependency} but does not declare it:`)
  for (const file of issue.files.slice(0, 8)) console.error(`  - ${file}`)
  if (issue.files.length > 8) console.error(`  - ...and ${issue.files.length - 8} more`)
}

for (const issue of result.invalidProtocols) {
  console.error(
    `[workspace-deps] ${issue.project} declares ${issue.dependency} in ${issue.field} as ${String(issue.version)}; use workspace:*.`
  )
}

process.exitCode = 1
