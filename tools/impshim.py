"""Stand-in for the `imp` module, gone since Python 3.12.

s2protocol uses only find_module/load_module, and only to load a
`protocol<build>.py` file out of its own directory. importlib does the same
thing; this keeps the shim inside our own process rather than patching the
installed package.
"""
import importlib.util
import os
import sys
import types

if 'imp' not in sys.modules:
    shim = types.ModuleType('imp')

    def find_module(name, paths):
        for base in paths:
            path = os.path.join(base, name + '.py')
            if os.path.exists(path):
                return (None, path, ('.py', 'r', 1))
        raise ImportError(name)

    def load_module(name, fp, pathname, description):
        spec = importlib.util.spec_from_file_location(name, pathname)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        sys.modules[name] = module
        return module

    shim.find_module = find_module
    shim.load_module = load_module
    sys.modules['imp'] = shim
