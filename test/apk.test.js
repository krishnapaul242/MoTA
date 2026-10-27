const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validPackage,packageFromBadging,packageFromFailure,isInstallConflict}=require('../out/apk');
test('APK metadata reads actual application ID without guessing from file names',()=>{
 assert.equal(packageFromBadging("package: name='com.dalvoy.appone' versionCode='21219' versionName='2.12.19'"),'com.dalvoy.appone');
 assert.equal(packageFromBadging("package: name='com.app;rm'"),undefined);
});
test('conflicting package ID is extracted from Android errors',()=>{
 assert.equal(packageFromFailure('INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package com.dalvoy.appone signatures do not match newer version; ignoring!'),'com.dalvoy.appone');
 assert.equal(packageFromFailure('INSTALL_FAILED_TEST_ONLY'),undefined);
 assert.ok(isInstallConflict('INSTALL_FAILED_UPDATE_INCOMPATIBLE'));
 assert.ok(isInstallConflict('INSTALL_PARSE_FAILED_INCONSISTENT_CERTIFICATES'));
 assert.ok(!isInstallConflict('INSTALL_FAILED_INSUFFICIENT_STORAGE'));
});
test('package identifiers reject shell text and flags',()=>{
 for(const p of ['com.example.app','com.Example.app_debug']) assert.ok(validPackage(p));
 for(const p of ['--user','com.app; rm','com.app/name','com..app','']) assert.ok(!validPackage(p));
});
