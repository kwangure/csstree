// This script is written as CommonJS since it should run (convert and test)
// on Node.js versions which don't support ESM

const fs = require('fs');
const path = require('path');
const { rollup } = require('rollup');

const { name: packageName } = require('../package.json');
const treeshake = 'smallest'; // see https://rollupjs.org/guide/en/#treeshake
const patchImportSelf = 'auto'; // 'auto' | false | true
const testFilePattern = /\/__tests\//;
const external = [
    'fs',
    'path',
    'assert',
    'json-to-ast',
    'css-tree',
    /^source-map/
];

convertAll([{
    entryPoints: ['./lib/index.js', ...readDir('./lib/__tests')],
    outputDir: './cjs'
}]);


//
// helpers
//

function readDir(dir, pattern = /\.js$/) {
    return fs.readdirSync(dir)
        .map(fn => `${dir}/${fn}`)
        .filter(fn => fs.statSync(fn).isFile() && pattern.test(fn));
}

function removeCreateRequire() {
    return {
        name: 'remove-createRequire',
        transform(code) {
            return code
                .replace(/import { createRequire } from 'module';\n?/, '')
                .replace(/const require = createRequire\(.+?\);\n?/, '');
        }
    };
}

function patchTests() {
    if (patchImportSelf === false) {
        return;
    }

    // If Node.js doesn't support for `exports` it doesn't support for import/require
    // by package name inside the package itself, so this require() call will fail.
    // We can't use `require(packageName)` here since CJS modules are not generated yet,
    // and Node.js will fail on resolving it disregarding of `exports` support.
    // In this case we need to replace import/require using a package name with
    // a relative path to a module.
    try {
        if (patchImportSelf === 'auto') {
            require(`${packageName}/package.json`);
            return;
        }
    } catch (e) {}

    const pathToIndex = path.resolve(__dirname, '../lib/index.js');

    // Make replacement for relative path only for tests since we need to check everything
    // is work on old Node.js version. The rest of code should be unchanged since it will run
    // on any Node.js version.
    console.log(`Fixing CommonJS tests by replacing "${packageName}" for a relative paths`);

    return {
        name: 'cjs-tests-fix',
        transform(code, id) {
            if (testFilePattern.test(id)) {
                return code.replace(
                    new RegExp(`from (['"])${packageName}\\1;`, 'g'),
                    `from '${path.relative(path.dirname(id), pathToIndex)}'`
                );
            }
        }
    };
}

async function convert({ entryPoints, outputDir }) {
    const startTime = Date.now();

    console.log();
    console.log(`Convert ESM to CommonJS (output: ${outputDir})`);

    const res = await rollup({
        input: entryPoints,
        external,
        treeshake,
        plugins: [
            removeCreateRequire(),
            patchTests()
        ]
    });
    await res.write({
        dir: outputDir,
        entryFileNames: '[name].cjs',
        format: 'cjs',
        exports: 'auto',
        preserveModules: true,
        interop: false,
        esModule: false,
        generatedCode: {
            constBindings: true
        }
    });

    console.log(`Done in ${Date.now() - startTime}ms`);
}

async function convertAll(config) {
    for (const entry of config) {
        await convert(entry);
    }
}
