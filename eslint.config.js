module.exports = [
    {
        'name': 'root',
        'files': [
            'src/**/*.ts'
        ],
        'languageOptions': {
            'ecmaVersion': 6,
            'sourceType': 'module',
            'parser': require('@typescript-eslint/parser'),
        },
        'plugins': {
            '@stylistic': require('@stylistic/eslint-plugin'),
            '@typescript': require('@typescript-eslint/eslint-plugin'),
        },
        'rules': {
            'no-throw-literal': 'error',
            'semi': 'error',
            'no-extra-semi': 'error',
            'eqeqeq': 'error',
            'prefer-const': 'warn',
            'curly': 'warn',
            '@typescript/naming-convention': [
                'warn',
                {
                    'selector': 'import',
                    'format': [ 'camelCase', 'PascalCase' ]
                }
            ],
            '@stylistic/indent': ['warn', 4],
            '@stylistic/quotes': ['warn', 'single'],
            '@stylistic/brace-style': ['warn', '1tbs'],
            '@stylistic/curly-newline': ['warn', {'minElements': 1, 'consistent': true}],
            '@stylistic/keyword-spacing': 'warn',
            '@stylistic/space-before-blocks': 'warn',
        },
    }
];
