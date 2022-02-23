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
import { IConfigurationInfo, IProjectInfo } from './interface';
import * as YAML from 'js-yaml';
import { ASTOperator, IFileAstInfo, ImportType } from './ast';
import * as ts from 'typescript';
import * as globby from 'globby';
import {
  astToValue,
  AST_VALUE_TYPE,
  createAstValue,
  IValueDefine,
  valueToAst,
} from './astUtils';
const factory = ts.factory;

export class UpgradePlugin extends BasePlugin {
  canUpgrade = false;
  astInstance: ASTOperator;

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

    const pkgJson = JSON.parse(readFileSync(pkgFile, 'utf-8'));
    this.projectInfo.pkg = {
      file: pkgFile,
      data: pkgJson,
    };

    const framework = midwayFrameworkInfo.find(frameworkInfo => {
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

    // midway hooks 支持
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

    this.core.debug('projectInfo', this.projectInfo);
  }

  async handleFrameworkUpgrade() {
    // 2 升级 3
    if (this.projectInfo.frameworkInfo.version.major === '2') {
      await this.handleConfiguration2To3();
      await this.handleHttpDecorators2To3();
      const pkgJson = this.projectInfo.pkg.data;
      pkgJson.dependencies[this.projectInfo.frameworkInfo.info.module] =
        '^3.0.0';
      const notNeedUpgreade = ['@midwayjs/logger', '@midwayjs/egg-ts-helper'];
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
    await writeFile(
      this.projectInfo.pkg.file,
      JSON.stringify(this.projectInfo.pkg.data, null, 2)
    );
    const nmDir = join(this.projectInfo.cwd, 'node_modules');
    if (existsSync(nmDir)) {
      await remove(nmDir);
    }
    this.core.cli.log('Upgrade success!');
  }

  // 升级 configuration 从2版本到3版本
  async handleConfiguration2To3() {
    const { frameworkInfo, midwayTsSourceRoot } = this.projectInfo;
    const configurationInfo = this.getConfiguration();
    const { astInfo } = configurationInfo;

    let frameworkName = frameworkInfo.info.type + 'Framework';
    // 检测有没有引入框架
    const importInfo = this.astInstance.getImportedModuleInfo(
      astInfo,
      frameworkInfo.info.module
    );
    if (importInfo?.type === ImportType.NAMESPACED) {
      frameworkName = importInfo.name;
    } else {
      // 没有引入框架的时候
      // 添加框架依赖
      this.astInstance.addImportToFile(astInfo, {
        moduleName: frameworkInfo.info.module,
        name: frameworkName,
        isNameSpace: true,
      });
    }

    // 添加到 configuration 的 imports 中
    await this.setConfigurationDecorator(
      'imports',
      [{ type: AST_VALUE_TYPE.Identifier, value: frameworkName }],
      false,
      configurationInfo
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
            // 避免config文件是空的
            if (!configData.includes('export ')) {
              writeFileSync(configFile, configData + '\nexport default {};');
            }
            const res = envConfigFileReg.exec(file);
            const env = res[1];
            const envVarName = env + 'Config';
            // import 到 configuration 文件中
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
    // 把 config 进行替换
    // 移除老的
    await this.setConfigurationDecorator(
      'importConfigs',
      [],
      true,
      configurationInfo
    );
    // 添加新的
    await this.setConfigurationDecorator(
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

    // 老版本需要依赖 path 模块的 join 来处理 config，需要检测有没有其他地方使用，如果没有则移除掉
    const code = this.astInstance.getPrinter().printFile(astInfo.file);
    if (!code.includes('join(')) {
      this.astInstance.removeImportFromFile(astInfo, {
        moduleName: 'path',
        name: ['join'],
      });
    }
  }

  async handleHttpDecorators2To3() {
    // @Query() name to @Query('name') name
    // Query/Body/Param/Header
    const decorators = ['Query', 'Body', 'Param', 'Header'];
    const allFileAstInfo = this.astInstance.getAllFileAstInfo();
    for (const { filePath, fileAstInfo } of allFileAstInfo) {
      const sourceFile: ts.SourceFile = fileAstInfo.file;
      // 检测是否由 @midwayjs/decorator 引入
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
        // 找到 class 中的所有方法
        const methods: any = (statement as ts.ClassDeclaration).members.filter(
          member => member.kind === ts.SyntaxKind.MethodDeclaration
        );
        for (const method of methods) {
          if (!method.parameters?.length) {
            return;
          }
          // 找到 方法中的参数列表
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

  private getConfiguration(): IConfigurationInfo {
    const { midwayTsSourceRoot } = this.projectInfo;
    // 确保存在
    const configurationFilePath = resolve(
      midwayTsSourceRoot,
      'configuration.ts'
    );
    let configurationAstInfo: IFileAstInfo;
    if (existsSync(configurationFilePath)) {
      const configurationAstList = this.astInstance.getAstByFile(
        configurationFilePath
      );
      configurationAstInfo = configurationAstList[0];
    } else {
      configurationAstInfo = {
        file: ts.createSourceFile(
          configurationFilePath,
          '',
          ts.ScriptTarget.ES2018
        ),
        fileName: configurationFilePath,
        changed: true,
      };
      this.astInstance.setCache(configurationFilePath, [configurationAstInfo]);
    }

    let configurationClass = configurationAstInfo.file.statements.find(
      statement => {
        return (
          statement.kind === ts.SyntaxKind.ClassDeclaration &&
          statement.decorators.find(decorator => {
            return (
              (decorator.expression as any)?.expression?.escapedText ===
              'Configuration'
            );
          })
        );
      }
    );

    const configurationFunc = configurationAstInfo.file.statements.find(
      statement => {
        return (
          statement.kind === ts.SyntaxKind.ExportAssignment &&
          (statement as any)?.expression?.expression?.escapedText ===
            'createConfiguration'
        );
      }
    );

    if (!configurationClass) {
      if (!configurationFunc) {
        configurationClass = factory.createClassDeclaration(
          [
            factory.createDecorator(
              factory.createCallExpression(
                factory.createIdentifier('Configuration'),
                undefined,
                [
                  factory.createObjectLiteralExpression(
                    [
                      factory.createPropertyAssignment(
                        factory.createIdentifier('imports'),
                        factory.createArrayLiteralExpression([], false)
                      ),
                      factory.createPropertyAssignment(
                        factory.createIdentifier('importConfigs'),
                        factory.createArrayLiteralExpression([], false)
                      ),
                    ],
                    true
                  ),
                ]
              )
            ),
          ],
          [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
          factory.createIdentifier('AutoConfiguraion'),
          undefined,
          undefined,
          []
        );

        (configurationAstInfo.file as any).statements =
          configurationAstInfo.file.statements.concat(configurationClass);
        configurationAstInfo.changed = true;
        this.astInstance.addImportToFile(configurationAstInfo, {
          moduleName: '@midwayjs/decorator',
          name: ['Configuration'],
        });
      }
    }

    return {
      astInfo: configurationAstInfo,
      class: configurationClass as unknown as ts.ClassDeclaration,
      func: (configurationFunc as ts.ExportAssignment)
        ?.expression as unknown as ts.CallExpression,
    };
  }

  // 设置 configuration 的装饰器中的 属性
  public setConfigurationDecorator(
    paramKey: string,
    values: IValueDefine[],
    isRemove?: boolean,
    configurationInfo?: IConfigurationInfo
  ) {
    if (!configurationInfo) {
      configurationInfo = this.getConfiguration();
    }
    let argObj;
    if (configurationInfo.class) {
      const { decorators } = configurationInfo.class;
      const decorator = decorators.find(decorator => {
        return (
          (decorator.expression as any)?.expression?.escapedText ===
          'Configuration'
        );
      });
      // 装饰器参数
      const args = (decorator.expression as any).arguments;
      if (!args.length) {
        args.push(ts.createObjectLiteral([], true));
      }
      argObj = args[0];
    } else if (configurationInfo.func) {
      argObj = configurationInfo.func.arguments[0];
    } else {
      return;
    }

    let findParam = argObj.properties.find(property => {
      return property?.name?.escapedText === paramKey;
    });
    // 如果没有对应的值
    if (!findParam) {
      findParam = ts.createPropertyAssignment(
        ts.createIdentifier(paramKey),
        createAstValue([])
      );
      argObj.properties.push(findParam);
    }

    // 如果值是数组
    const current = findParam.initializer.elements.map(element => {
      return astToValue(element);
    });

    let newElementList = [];
    if (isRemove) {
      if (values.length) {
        current.forEach(element => {
          const exists = values.find(value => {
            return value.type === element.type && value.value === element.value;
          });
          if (exists) {
            return;
          }
          newElementList.push(element);
        });
      }
    } else {
      newElementList = current;
      values.forEach(element => {
        const exists = newElementList.find(value => {
          return value.type === element.type && value.value === element.value;
        });
        if (exists) {
          return;
        }
        newElementList.push(element);
      });
    }
    findParam.initializer.elements = newElementList.map(element => {
      return valueToAst(element);
    });
    const configurationFilePath = resolve(
      this.projectInfo.midwayTsSourceRoot,
      'configuration.ts'
    );
    this.astInstance.setAstFileChanged(configurationFilePath);
  }
}
