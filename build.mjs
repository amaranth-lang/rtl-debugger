import * as esbuild from 'esbuild';
import metaUrlPlugin from '@chialab/esbuild-plugin-meta-url';

const mode = (process.argv[2] ?? 'build');

const commonOptions = {
    logLevel: 'info',
    plugins: [metaUrlPlugin()],
    bundle: true,
    loader: {
        '.html': 'text',
        '.wasm': 'file',
    },
    target: 'es2021',
    sourcemap: 'linked',
    outdir: 'out/',
};

const contexts = [
    await esbuild.context({
        external: ['vscode'],
        format: 'cjs',
        platform: 'node',
        entryPoints: {
            'extension': './src/extension.ts',
        },
        ...commonOptions
    }),
    await esbuild.context({
        format: 'esm',
        platform: 'browser',
        entryPoints: {
            'surferEmbed': './src/surfer/embed.ts',
        },
        ...commonOptions
    }),
];

if (mode === 'build') {
    for (const context of contexts) {
        await context.rebuild();
        await context.dispose();
    }
} else if (mode === 'watch') {
    for (const context of contexts) {
        await context.watch();
    }
} else {
    console.error(`Usage: ${process.argv0} [build|watch]`);
}
