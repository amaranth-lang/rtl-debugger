import * as esbuild from 'esbuild';

const mode = (process.argv[2] ?? 'build');

const commonOptions = {
    logLevel: 'info',
    bundle: true,
    target: 'es2021',
    sourcemap: 'linked',
    outdir: 'out/',
};

const extensionContext = await esbuild.context({
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    entryPoints: {
        'extension': './src/extension.ts',
    },
    ...commonOptions
});

if (mode === 'build') {
    await extensionContext.rebuild();
    await extensionContext.dispose();
} else if (mode === 'watch') {
    await extensionContext.watch();
} else {
    console.error(`Usage: ${process.argv0} [build|watch]`);
}
