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
            '@typescript-eslint': require('@typescript-eslint/eslint-plugin'),
        },
        'rules': {
            'semi': 'error',
            'no-throw-literal': 'error',
            'curly': 'warn',
            'eqeqeq': 'warn',
            '@typescript-eslint/naming-convention': [
                'warn',
                {
                    'selector': 'import',
                    'format': [ 'camelCase', 'PascalCase' ]
                }
            ],
        },
    }
];
