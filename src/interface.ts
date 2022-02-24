import { IDenpendencyModuleInfo, IFileAstInfo } from './ast';
import { MidwayFramework } from './constants';
import * as ts from 'typescript';
import { IValueDefine } from './astUtils';
import { IPropertyInfo } from './configuration';

export interface IProjectInfo {
  cwd: string;
  pkg: {
    file: string;
    data: any;
  };
  framework: MidwayFramework;
  withServerlessYml: boolean;
  serverlessYml: {
    file: string;
    data: IServerlessYmlData;
  };
  frameworkInfo?: {
    version: IVersion;
    info: ImidwayFrameworkInfo;
  };
  hooksInfo?: IVersion;
  intergrationInfo?: IVersion;
  midwayTsSourceRoot: string;
}

export interface IVersion {
  major: string;
  minor: string;
  patch: string;
}

export interface IServerlessYmlData {
  provider?: {
    name?: string;
  };
}

export interface ImidwayFrameworkInfo {
  module: string;
  type: MidwayFramework;
}

export interface IConfigurationInfo {
  astInfo: IFileAstInfo;
  class: ts.ClassDeclaration;
  func: ts.CallExpression;
}

export interface IPluginsInfo {
  property?: {
    name: string;
    info: IPropertyInfo;
  }[];
  dependencies?: {
    name: string;
    version: string;
  }[];
  imports?: IValueDefine[];
  modImport?: IDenpendencyModuleInfo[];
  onReadyBlocks?: string[];
  tips?: string[];
}
