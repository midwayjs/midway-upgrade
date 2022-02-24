import { writeFileSync } from 'fs-extra';
import * as YAML from 'js-yaml';
export const removeDeps = (pkgJson, ...depsNames: string[]) => {
  depsNames.forEach(dep => {
    delete pkgJson.dependencies[dep];
    delete pkgJson.devDependencies[dep];
  });
};

export const saveYaml = (filePath, data) => {
  const text = YAML.dump(data, {
    skipInvalid: true,
  });
  try {
    writeFileSync(filePath, text);
  } catch (err) {
    throw new Error(`generate ${filePath} error, ${err.message}`);
  }
};
