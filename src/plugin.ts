import {
  BasePlugin,
  findNpmModule,
  formatModuleVersion,
} from '@midwayjs/command-core';
import {
  existsSync,
  readdir,
  readFileSync,
  stat,
  writeFileSync,
  writeFile,
  remove,
} from 'fs-extra';
import { join, resolve } from 'path';
import { MidwayFramework, midwayFrameworkInfo } from './constants';
import { IProjectInfo } from './interface';
import * as YAML from 'js-yaml';
import { ASTOperator, ImportType } from './ast';
import * as ts from 'typescript';
import * as globby from 'globby';
import { AST_VALUE_TYPE } from './astUtils';
import { saveYaml } from './utils';
import { Configuration } from './configuration';
const factory = ts.factory;

export class UpgradePlugin extends BasePlugin {
  canUpgrade = false;
  astInstance: ASTOperator;
  configurationInstance: Configuration;

  projectInfo: IProjectInfo = {
    cwd: process.cwd(),
    pkg: {
      file: '',
      data: {},
    },
    serverlessYml: {
      file: '',
      data: {},
    },
    framework: MidwayFramework.Unknown,
    withServerlessYml: false,
    midwayTsSourceRoot: '',
  };

  commands = {
    upgrade: {
      usage: 'upgrade to new version',
      lifecycleEvents: ['projectInfo', 'framework', 'final'],
    },
  };

  hooks = {
    'upgrade:projectInfo': this.getProjectInfo.bind(this),
    'upgrade:framework': this.handleFrameworkUpgrade.bind(this),
    'upgrade:final': this.final.bind(this),
  };

  async getProjectInfo() {
    const cwd = (this.projectInfo.cwd = this.getCwd());
    const pkgFile = join(cwd, 'package.json');
    if (!pkgFile) {
      return;
    }

    this.astInstance = new ASTOperator();

    this.configurationInstance = new Configuration(
      this.projectInfo,
      this.astInstance
    );

    const pkgJson = JSON.parse(readFileSync(pkgFile, 'utf-8'));
    this.projectInfo.pkg = {
      file: pkgFile,
      data: pkgJson,
    };

    const framework = this.getMidwayFrameworkInfo().find(frameworkInfo => {
      const version = this.getModuleVersion(frameworkInfo.module);
      if (!version) {
        return;
      }
      this.projectInfo.frameworkInfo = {
        info: frameworkInfo,
        version,
      };
      return true;
    });

    if (!framework) {
      throw new Error('current project unsupport');
    }

    this.projectInfo.framework = framework.type;
    const yamlFile = join(cwd, 'f.yml');
    this.projectInfo.withServerlessYml = existsSync(yamlFile);

    if (this.projectInfo.withServerlessYml) {
      const contents = readFileSync(yamlFile).toString();
      this.projectInfo.serverlessYml = {
        file: yamlFile,
        data: YAML.load(contents.toString(), {}),
      };
    }

    // midway hooks ??????
    const midwayConfig = [
      join(cwd, 'midway.config.ts'),
      join(cwd, 'midway.config.js'),
    ].find(file => existsSync(file));
    if (midwayConfig) {
      const modInfo =
        findNpmModule(cwd, '@midwayjs/hooks/internal') ||
        findNpmModule(cwd, '@midwayjs/hooks-core');
      if (modInfo) {
        const { getConfig } = require(modInfo);
        const config = getConfig(cwd);
        if (config.source) {
          this.projectInfo.midwayTsSourceRoot = config.source;
        }
      }
      this.projectInfo.hooksInfo = this.getModuleVersion(modInfo);
    } else {
      this.projectInfo.hooksInfo = ['@midwayjs/hooks']
        .map(moduleName => {
          return this.getModuleVersion(moduleName);
        })
        .find(versionInfo => !!versionInfo);
    }

    this.projectInfo.intergrationInfo =
      existsSync(join(cwd, 'src/apis')) &&
      ['react', 'rax']
        .map(moduleName => {
          return this.getModuleVersion(moduleName);
        })
        .find(versionInfo => !!versionInfo);

    if (!this.projectInfo.midwayTsSourceRoot) {
      this.projectInfo.midwayTsSourceRoot = join(cwd, 'src');
      if (this.projectInfo.intergrationInfo) {
        this.projectInfo.midwayTsSourceRoot = join(cwd, 'src/apis');
      }
    }

    const allFiles = await globby('**/*.ts', {
      cwd,
      ignore: ['**/node_modules/**'],
    });

    await this.astInstance.getAstByFile(
      allFiles.map(fileName => resolve(cwd, fileName))
    );

    this.configurationInstance.get();
    this.core.debug('projectInfo', this.projectInfo);
  }

  getMidwayFrameworkInfo() {
    return midwayFrameworkInfo;
  }

  async handleFrameworkUpgrade() {
    // 2 ?????? 3
    if (this.projectInfo.frameworkInfo.version.major === '2') {
      await this.handleConfiguration2To3();
      await this.insteadDecorator2To3();
      await this.handleHttpDecorators2To3();
      const pkgJson = this.projectInfo.pkg.data;
      pkgJson.dependencies[this.projectInfo.frameworkInfo.info.module] =
        '^3.0.0';
      const notNeedUpgreade = [
        '@midwayjs/logger',
        '@midwayjs/egg-ts-helper',
        '@midwayjs/luckyeye',
      ];
      Object.keys(pkgJson.dependencies).map(depName => {
        if (
          !depName.startsWith('@midwayjs/') ||
          notNeedUpgreade.includes(depName) ||
          depName.includes('cli')
        ) {
          return;
        }
        pkgJson.dependencies[depName] = '^3.0.0';
      });

      Object.keys(pkgJson.devDependencies).map(depName => {
        if (
          !depName.startsWith('@midwayjs/') ||
          notNeedUpgreade.includes(depName) ||
          depName.includes('cli')
        ) {
          return;
        }
        pkgJson.devDependencies[depName] = '^3.0.0';
      });

      if (!pkgJson.devDependencies['cross-env']) {
        pkgJson.devDependencies['cross-env'] = '^7.0.3';
      }

      if (!pkgJson.devDependencies['ts-node']) {
        pkgJson.devDependencies['ts-node'] = '^10.0.0';
      }

      switch (this.projectInfo.framework) {
        case MidwayFramework.FaaS:
          await this.faas2To3();
          break;
        case MidwayFramework.Web:
          await this.web2to3();
          break;
      }
      this.canUpgrade = true;
      return;
    }
  }

  async final() {
    if (!this.canUpgrade) {
      const { version } = this.projectInfo.frameworkInfo;
      return this.core.cli.log(
        `The current framework version (${this.projectInfo.framework} ${version.major}.${version.minor}) does not support upgrading`
      );
    }

    this.astInstance.done();
    if (this.projectInfo.serverlessYml.file) {
      saveYaml(
        this.projectInfo.serverlessYml.file,
        this.projectInfo.serverlessYml.data
      );
    }
    await writeFile(
      this.projectInfo.pkg.file,
      JSON.stringify(this.projectInfo.pkg.data, null, 2)
    );
    const nmDir = join(this.projectInfo.cwd, 'node_modules');
    if (existsSync(nmDir)) {
      await remove(nmDir);
    }
    this.core.cli.log('');
    this.core.cli.log('Upgrade success!');
    this.core.cli.log('');
    this.core.cli.log('Please reinstall the dependencies, e.g., npm install');
    this.core.cli.log('');
  }

  // ?????? configuration ???2?????????3??????
  async handleConfiguration2To3() {
    const { frameworkInfo, midwayTsSourceRoot } = this.projectInfo;
    const configurationInfo = this.configurationInstance.get();
    const { astInfo } = configurationInfo;

    let frameworkName = frameworkInfo.info.type + 'Framework';
    // ???????????????????????????
    const importInfo = this.astInstance.getImportedModuleInfo(
      astInfo,
      frameworkInfo.info.module
    );
    if (importInfo?.type === ImportType.NAMESPACED) {
      frameworkName = importInfo.name;
    } else {
      // ???????????????????????????
      // ??????????????????
      this.astInstance.addImportToFile(astInfo, {
        moduleName: frameworkInfo.info.module,
        name: frameworkName,
        isNameSpace: true,
      });
    }

    // ????????? configuration ??? imports ???
    await this.configurationInstance.setDecorator(
      'imports',
      [{ type: AST_VALUE_TYPE.Identifier, value: frameworkName }],
      false,
      configurationInfo,
      true
    );

    const envConfigFilesDir = join(midwayTsSourceRoot, 'config');
    const configProps: ts.ObjectLiteralElementLike[] = [];
    if (existsSync(envConfigFilesDir)) {
      const configFileDir = await stat(envConfigFilesDir);
      if (configFileDir.isDirectory()) {
        const allFiles = await readdir(envConfigFilesDir);
        allFiles.forEach(file => {
          const envConfigFileReg = /^config\.(\w+)\.ts$/;
          if (envConfigFileReg.test(file)) {
            const configFile = join(envConfigFilesDir, file);
            const configData = readFileSync(configFile, 'utf-8');
            // ??????config???????????????
            if (!configData.includes('export ')) {
              writeFileSync(configFile, configData + '\nexport default {};');
            } else if (/(^|\s|\n)export\s*=\s*/.test(configData)) {
              writeFileSync(
                configFile,
                configData.replace(
                  /(^|\s|\n)export\s*=\s*/,
                  '$1export default '
                )
              );
            }
            const res = envConfigFileReg.exec(file);
            const env = res[1];
            const envVarName = env + 'Config';
            // import ??? configuration ?????????
            this.astInstance.addImportToFile(astInfo, {
              moduleName: `./config/config.${env}`,
              name: envVarName,
              isNameSpace: true,
            });
            configProps.push(
              factory.createPropertyAssignment(
                factory.createIdentifier(env),
                factory.createIdentifier(env + 'Config')
              )
            );
          }
        });
      }
    }
    // ??? config ????????????
    // ????????????
    await this.configurationInstance.setDecorator(
      'importConfigs',
      [],
      true,
      configurationInfo
    );
    // ????????????
    await this.configurationInstance.setDecorator(
      'importConfigs',
      [
        {
          type: AST_VALUE_TYPE.AST,
          value: factory.createObjectLiteralExpression(configProps),
        },
      ],
      false,
      configurationInfo
    );

    // ????????????????????? path ????????? join ????????? config?????????????????????????????????????????????????????????????????????
    const code = this.astInstance.getPrinter().printFile(astInfo.file);
    if (!code.includes('join(')) {
      this.astInstance.removeImportFromFile(astInfo, {
        moduleName: 'path',
        name: ['join'],
      });
    }
  }

  async insteadDecorator2To3() {
    // ?????????????????????
    const allFileAstInfo = this.astInstance.getAllFileAstInfo();
    let isImportValidate = false;
    const validateModule = '@midwayjs/validate';
    for (const { fileAstInfo } of allFileAstInfo) {
      const validateDecoRes = ['Validate', 'Rule', 'RuleType'].map(deco => {
        return this.astInstance.insteadImport(
          fileAstInfo,
          '@midwayjs/decorator',
          deco,
          validateModule,
          deco
        );
      });
      if (validateDecoRes.includes(true)) {
        isImportValidate = true;
      }
    }

    // ?????? @midwayjs/validate
    if (isImportValidate) {
      const pkgJson = this.projectInfo.pkg.data;
      pkgJson.dependencies[validateModule] = '^3.0.0';
      // ???????????????????????????
      const configurationInfo = this.configurationInstance.get();
      const { astInfo } = configurationInfo;
      const importInfo = this.astInstance.getImportedModuleInfo(
        astInfo,
        validateModule
      );
      let validateComponnetName = 'validateComp';
      if (importInfo?.type === ImportType.NAMESPACED) {
        validateComponnetName = importInfo.name;
      } else {
        // ???????????????????????????
        // ??????????????????
        this.astInstance.addImportToFile(astInfo, {
          moduleName: validateModule,
          name: validateComponnetName,
          isNameSpace: true,
        });
      }
      await this.configurationInstance.setDecorator(
        'imports',
        [{ type: AST_VALUE_TYPE.Identifier, value: validateComponnetName }],
        false,
        configurationInfo
      );
    }
  }

  async handleHttpDecorators2To3() {
    // @Query() name to @Query('name') name
    // Query/Body/Param/Header
    const decorators = ['Query', 'Body', 'Param', 'Header'];
    const allFileAstInfo = this.astInstance.getAllFileAstInfo();
    for (const { filePath, fileAstInfo } of allFileAstInfo) {
      const sourceFile: ts.SourceFile = fileAstInfo.file;
      // ??????????????? @midwayjs/decorator ??????
      const importDefine = this.astInstance.getImportFromFile(
        sourceFile,
        '@midwayjs/decorator'
      )[0];
      if (!importDefine) {
        continue;
      }
      const { importClause } = importDefine as any;
      if (importClause.namedBindings.kind !== ts.SyntaxKind.NamedImports) {
        continue;
      }
      const elementNames = importClause.namedBindings.elements.map(element => {
        return (
          element.propertyName?.escapedText || element.name.escapedText
        ).toString();
      });
      const existsNeedInsteadDeco = elementNames.find(name =>
        decorators.includes(name)
      );
      if (!existsNeedInsteadDeco) {
        continue;
      }
      for (const statement of sourceFile.statements) {
        if (statement.kind !== ts.SyntaxKind.ClassDeclaration) {
          continue;
        }
        // ?????? class ??????????????????
        const methods: any = (statement as ts.ClassDeclaration).members.filter(
          member => member.kind === ts.SyntaxKind.MethodDeclaration
        );
        for (const method of methods) {
          if (!method.parameters?.length) {
            continue;
          }
          // ?????? ????????????????????????
          for (const parameter of method.parameters) {
            (parameter as any).decorators = (
              (parameter as any).decorators || []
            ).map((deco: ts.Decorator) => {
              if (
                deco.expression.kind === ts.SyntaxKind.CallExpression &&
                decorators.includes(
                  (deco.expression as any).expression.escapedText
                ) &&
                !(deco.expression as any).arguments?.length
              ) {
                (deco.expression as any).arguments = [
                  factory.createStringLiteral(parameter.name.escapedText, true),
                ];
              }
              return deco;
            });
          }
        }
      }
      this.astInstance.setAstFileChanged(filePath);
    }
  }
  async faas2To3() {
    const pkgJson = this.projectInfo.pkg.data;

    delete pkgJson.dependencies['@midwayjs/serverless-app'];

    pkgJson.devDependencies['@midwayjs/serverless-app'] = '^3.0.0';

    const provider = this.projectInfo.serverlessYml?.data?.provider?.name;

    if (provider === 'aliyun' || provider === 'fc') {
      pkgJson.devDependencies['@midwayjs/serverless-fc-starter'] = '^3.0.0';
      pkgJson.devDependencies['@midwayjs/serverless-fc-trigger'] = '^3.0.0';
    } else if (provider === 'scf') {
      pkgJson.devDependencies['@midwayjs/serverless-scf-starter'] = '^3.0.0';
      pkgJson.devDependencies['@midwayjs/serverless-scf-trigger'] = '^3.0.0';
    }
  }

  async web2to3() {
    const pkgJson = this.projectInfo.pkg.data;
    pkgJson.devDependencies['egg-mock'] = '^4.2.0';
  }

  private getCwd() {
    return this.core.config?.servicePath || this.core.cwd || process.cwd();
  }

  private getModuleVersion(moduleName: string) {
    const pkgJson = this.projectInfo.pkg.data as any;

    const cwd = this.projectInfo.cwd;
    if (existsSync(join(cwd, 'node_modules'))) {
      try {
        const modulePkgJson = require.resolve(moduleName + '/package.json', {
          paths: [cwd],
        });
        const pkg = JSON.parse(readFileSync(modulePkgJson, 'utf-8'));
        return formatModuleVersion(pkg.version);
      } catch {
        //
      }
    }
    const version =
      pkgJson.dependencies?.[moduleName] ||
      pkgJson.devDependencies?.[moduleName];
    if (!version) {
      return;
    }
    return formatModuleVersion(version);
  }

  // ??????????????????
  globalInsteadCode(allSourceFileAstInfos, fromTo) {
    for (const { filePath } of allSourceFileAstInfos) {
      if (!existsSync(filePath)) {
        continue;
      }
      let fileStr = readFileSync(filePath).toString();
      for (const { from, to } of fromTo) {
        fileStr = fileStr.replace(from, to);
      }
      writeFileSync(filePath, fileStr);
    }
  }
}
