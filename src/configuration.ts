import { ASTOperator, IDenpendencyModuleInfo, IFileAstInfo } from './ast';
import { resolve } from 'path';
import { existsSync } from 'fs-extra';
import * as ts from 'typescript';
import {
  statementToCode,
  codeToBlock,
  createAstValue,
  valueToAst,
  IValueDefine,
  astToValue,
  AST_VALUE_TYPE,
} from './astUtils';
import { IConfigurationInfo, IPluginsInfo, IProjectInfo } from './interface';
const factory = ts.factory;

export interface IMethodInfo {
  async?: boolean;
  block?: string[];
  params?: Array<{ name: string }>;
}

export interface IPropertyInfo {
  decorator?: string;
  value?: any;
  params?: any[];
}

enum ConfigurationType {
  CLASS = 'class',
  FUNC = 'func',
}

export class Configuration {
  astInstance: ASTOperator;
  projectInfo: IProjectInfo;
  configurationType: ConfigurationType = ConfigurationType.CLASS;
  configurationClass: ts.ClassDeclaration;
  configurationFunc: ts.CallExpression;
  configurationAstInfo: IFileAstInfo;
  constructor(projectInfo: IProjectInfo, ast: ASTOperator) {
    this.astInstance = ast;
    this.projectInfo = projectInfo;
  }

  public get(): IConfigurationInfo {
    const { midwayTsSourceRoot } = this.projectInfo;
    // 确保存在
    let configurationAstInfo: IFileAstInfo = this.configurationAstInfo;
    if (!configurationAstInfo) {
      const configurationFilePath = resolve(
        midwayTsSourceRoot,
        'configuration.ts'
      );
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
        this.astInstance.setCache(configurationFilePath, [
          configurationAstInfo,
        ]);
      }
      this.configurationAstInfo = configurationAstInfo;
    }

    let configurationClass = configurationAstInfo.file.statements.find(
      statement => {
        if (statement.kind === ts.SyntaxKind.ClassDeclaration) {
          if (ts.canHaveDecorators(statement)) {
            return ts.getDecorators(statement).find(decorator => {
              return (
                (decorator.expression as any)?.expression?.escapedText ===
                'Configuration'
              );
            });
          }
        }
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

  public addImportToFile(modInfo: IDenpendencyModuleInfo) {
    const configurationFilePath = resolve(
      this.projectInfo.midwayTsSourceRoot,
      'configuration.ts'
    );
    const configurationAstList = this.astInstance.getAstByFile(
      configurationFilePath
    );
    const configurationAstInfo = configurationAstList[0];
    this.astInstance.addImportToFile(configurationAstInfo, modInfo);
  }

  // 设置 @configuration 的装饰器中的 属性
  public setDecorator(
    paramKey: string,
    values: IValueDefine[],
    isRemove?: boolean,
    configurationInfo?: IConfigurationInfo,
    insertToFirst?: boolean
  ) {
    if (!configurationInfo) {
      configurationInfo = this.get();
    }
    let argObj;
    if (configurationInfo.class) {
      if (ts.canHaveDecorators(configurationInfo.class)) {
        const decorators = ts.getDecorators(configurationInfo.class);
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
      }
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
      findParam = factory.createPropertyAssignment(
        factory.createIdentifier(paramKey),
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
        if (insertToFirst) {
          newElementList.unshift(element);
        } else {
          newElementList.push(element);
        }
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

  public setMethod(method: string, methodInfo: IMethodInfo) {
    if (!this.configurationClass) {
      return;
    }
    const statement: any = this.configurationClass;
    const findMethodMember = statement.members.find(member => {
      if (member.kind !== ts.SyntaxKind.MethodDeclaration) {
        return;
      }
      return member.name.escapedText === method;
    });

    // 如果没有找到，那很简单，创建就行了
    if (!findMethodMember) {
      const methodMember = ts.createMethod(
        undefined,
        methodInfo.async
          ? [ts.createModifier(ts.SyntaxKind.AsyncKeyword)]
          : undefined,
        undefined,
        ts.createIdentifier(method),
        undefined,
        undefined,
        (methodInfo.params || []).map(param => {
          return ts.createParameter(
            undefined,
            undefined,
            undefined,
            ts.createIdentifier(param.name),
            undefined,
            ts.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
            undefined
          );
        }),
        undefined,
        ts.createBlock(
          this.getBlockList(methodInfo.params, methodInfo.block),
          true
        )
      );
      statement.members.push(methodMember);
      return this;
    }

    // 如果找到了，直接把新的block塞入到老的方法内部
    const blockStatements = findMethodMember.body.statements;
    const newBlocks = this.getBlockList(methodInfo.params, methodInfo.block);
    const oldBlockStatementsCodes = blockStatements.map(statement =>
      statementToCode(statement)
    );
    newBlocks.forEach(block => {
      const blockFulltext = statementToCode(block);
      const exists = oldBlockStatementsCodes.find((code: string) => {
        return code === blockFulltext;
      });
      if (exists) {
        return;
      }
      blockStatements.push(block);
    });
    return this;
  }

  // 获取block的列表，代码段
  private getBlockList(paramsNameList, codeList) {
    if (!Array.isArray(codeList) || !codeList?.length) {
      return [];
    }
    const allMethodBlocks = [];
    codeList.map(code => {
      code = code.replace(
        /\$\{\s*args\[(\d+)\]\s*\}/gi,
        (matchedString, index) => {
          return paramsNameList[index]?.name ?? matchedString;
        }
      );
      const newBlock = codeToBlock(code);
      if (Array.isArray(newBlock)) {
        allMethodBlocks.push(...newBlock);
      } else {
        allMethodBlocks.push(newBlock);
      }
    });
    return allMethodBlocks;
  }

  // 处理属性
  public setProperty(property: string, propertyInfo: IPropertyInfo) {
    if (!this.configurationClass) {
      return;
    }
    const statement: any = this.configurationClass;
    const newProperty = factory.createPropertyDeclaration(
      propertyInfo.decorator
        ? [
            factory.createDecorator(
              factory.createCallExpression(
                ts.createIdentifier(propertyInfo.decorator),
                undefined,
                propertyInfo.params
                  ? propertyInfo.params.map(param => {
                      return createAstValue(param);
                    })
                  : []
              )
            ),
          ]
        : undefined,
      undefined,
      ts.createIdentifier(property),
      undefined,
      ts.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
      propertyInfo.value === undefined
        ? undefined
        : createAstValue(propertyInfo.value)
    );
    const findMemberIndex = statement.members.findIndex(member => {
      if (member.kind !== ts.SyntaxKind.PropertyDeclaration) {
        return;
      }
      return member.name.escapedText === property;
    });
    if (findMemberIndex !== -1) {
      statement.members[findMemberIndex] = newProperty;
    } else {
      statement.members.unshift(newProperty);
    }
    return this;
  }

  public setPlugins(pluginsInfos: IPluginsInfo[]) {
    for (const pluginsInfo of pluginsInfos) {
      if (!pluginsInfo) {
        continue;
      }
      if (pluginsInfo.imports) {
        this.setDecorator('imports', pluginsInfo.imports);
      }
      if (pluginsInfo.modImport) {
        pluginsInfo.modImport.forEach(modImport => {
          this.addImportToFile(modImport);
        });
      }
      if (pluginsInfo.onReadyBlocks) {
        this.setMethod('onReady', {
          block: pluginsInfo.onReadyBlocks,
          async: true,
        });
      }
      if (pluginsInfo.property) {
        pluginsInfo.property.forEach(property => {
          this.setProperty(property.name, property.info);
        });
      }
      if (pluginsInfo.dependencies) {
        pluginsInfo.dependencies.forEach(dependencie => {
          this.projectInfo.pkg.data.dependencies[dependencie.name] =
            dependencie.version;
        });
      }
    }
  }

  async importConfig(configDir) {
    this.get();
    this.addImportToFile({
      moduleName: 'path',
      name: ['join'],
    });
    // 移除老的
    this.setDecorator('importConfigs', [], true);
    // 添加新的
    this.setDecorator('importConfigs', [
      {
        type: AST_VALUE_TYPE.Func,
        value: 'join',
        arguments: [
          { type: AST_VALUE_TYPE.Identifier, value: '__dirname' },
          { type: AST_VALUE_TYPE.Value, value: configDir },
        ],
      },
    ]);
  }
}
