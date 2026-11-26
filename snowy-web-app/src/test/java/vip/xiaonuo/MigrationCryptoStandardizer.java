/*
 * Copyright [2022] [https://www.xiaonuo.vip]
 *
 * Snowy采用APACHE LICENSE 2.0开源协议，您在使用过程中，需要注意以下几点：
 *
 * 1.请不要删除和修改根目录下的LICENSE文件。
 * 2.请不要删除和修改Snowy源码头部的版权声明。
 * 3.本项目代码可免费商业使用，商业使用请保留源码和相关描述文件的项目出处，作者声明等。
 * 4.分发源码时候，请注明软件出处 https://www.xiaonuo.vip
 * 5.不可二次分发开源参与同类竞品，如有想法可联系团队xiaonuobase@qq.com商议合作。
 * 6.若您的项目无法满足以上几点，需要更多功能代码，获取Snowy商业授权许可，请在官网购买授权，地址为 https://www.xiaonuo.vip
 */
package vip.xiaonuo;

import cn.hutool.core.util.StrUtil;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import org.junit.Assert;
import org.junit.Test;
import vip.xiaonuo.common.util.CommonCryptogramUtil;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;

/**
 * warnsys -> snowy 迁移数据国密 SM3/SM4 标准化工具
 *
 * @author migration-bot
 * @date 2026/11/25
 */
public class MigrationCryptoStandardizer {

    private static String encryptSm4Safe(String plain) {
        if (StrUtil.isBlank(plain)) {
            return plain;
        }
        String cipher = CommonCryptogramUtil.doSm4CbcEncrypt(plain);
        String decoded = CommonCryptogramUtil.doSm4CbcDecrypt(cipher);
        if (!plain.equals(decoded)) {
            throw new IllegalStateException("SM4 加密回环校验失败");
        }
        return cipher;
    }

    private static JSONObject parseJsonSafe(String raw) {
        if (StrUtil.isBlank(raw)) {
            return JSONUtil.createObj();
        }
        try {
            return JSONUtil.parseObj(raw);
        } catch (Exception e) {
            return JSONUtil.createObj();
        }
    }

    public static void main(String[] args) throws Exception {
        System.setProperty("migration.crypto.run", "true");
        new MigrationCryptoStandardizer().runStandardizationIfEnabled();
    }

    @Test
    public void runStandardizationIfEnabled() throws Exception {
        if (!Boolean.getBoolean("migration.crypto.run")) {
            return;
        }
        String url = System.getProperty("migration.db.url",
                "jdbc:mysql://127.0.0.1:3307/snowy?useUnicode=true&characterEncoding=utf-8&useSSL=false&allowPublicKeyRetrieval=true");
        String user = System.getProperty("migration.db.user", "root");
        String pwd = System.getProperty("migration.db.password", "f20c6f5fa6e763cd");

        String defaultSm3 = CommonCryptogramUtil.doHashValue("Snowy@2026!");
        int sysPwdUpdated = 0;
        int sysSm4Updated = 0;
        int cliPwdUpdated = 0;
        int cliSm4Updated = 0;
        int spSm4Updated = 0;

        try (Connection conn = DriverManager.getConnection(url, user, pwd)) {
            conn.setAutoCommit(false);

            // 1. SYS_USER (19002%)
            try (PreparedStatement sel = conn.prepareStatement("SELECT ID, PASSWORD, PHONE, EXT_JSON FROM SYS_USER WHERE ID LIKE '19002%'");
                 PreparedStatement upd = conn.prepareStatement("UPDATE SYS_USER SET PASSWORD=?, PHONE=?, EXT_JSON=? WHERE ID=?")) {
                ResultSet rs = sel.executeQuery();
                while (rs.next()) {
                    String id = rs.getString("ID");
                    String password = rs.getString("PASSWORD");
                    String phone = rs.getString("PHONE");
                    JSONObject ext = parseJsonSafe(rs.getString("EXT_JSON"));

                    String nextPwd = "PENDING_SM3".equals(password) ? defaultSm3 : password;
                    if ("PENDING_SM3".equals(password)) {
                        sysPwdUpdated++;
                    }
                    String nextPhone = phone;
                    if (!ext.getBool("sm4_migrated", false)) {
                        nextPhone = encryptSm4Safe(phone);
                        ext.set("sm4_migrated", true);
                        sysSm4Updated++;
                    }
                    upd.setString(1, nextPwd);
                    upd.setString(2, nextPhone);
                    upd.setString(3, ext.toString());
                    upd.setString(4, id);
                    upd.addBatch();
                }
                upd.executeBatch();
            }

            // 2. CLIENT_USER (19003%)
            try (PreparedStatement sel = conn.prepareStatement("SELECT ID, PASSWORD, PHONE, EMERGENCY_PHONE, EXT_JSON FROM CLIENT_USER WHERE ID LIKE '19003%'");
                 PreparedStatement upd = conn.prepareStatement("UPDATE CLIENT_USER SET PASSWORD=?, PHONE=?, EMERGENCY_PHONE=?, EXT_JSON=? WHERE ID=?")) {
                ResultSet rs = sel.executeQuery();
                while (rs.next()) {
                    String id = rs.getString("ID");
                    String password = rs.getString("PASSWORD");
                    String phone = rs.getString("PHONE");
                    String emergencyPhone = rs.getString("EMERGENCY_PHONE");
                    JSONObject ext = parseJsonSafe(rs.getString("EXT_JSON"));

                    String nextPwd = password;
                    if ("PENDING_SM3".equals(password)) {
                        String initPlain = ext.getStr("initial_password_plain");
                        nextPwd = StrUtil.isNotBlank(initPlain)
                                ? CommonCryptogramUtil.doHashValue(initPlain)
                                : defaultSm3;
                        ext.remove("initial_password_plain");
                        cliPwdUpdated++;
                    }

                    String nextPhone = phone;
                    String nextEmergencyPhone = emergencyPhone;
                    if (!ext.getBool("sm4_migrated", false)) {
                        nextPhone = encryptSm4Safe(phone);
                        nextEmergencyPhone = encryptSm4Safe(emergencyPhone);
                        ext.set("sm4_migrated", true);
                        cliSm4Updated++;
                    }
                    upd.setString(1, nextPwd);
                    upd.setString(2, nextPhone);
                    upd.setString(3, nextEmergencyPhone);
                    upd.setString(4, ext.toString());
                    upd.setString(5, id);
                    upd.addBatch();
                }
                upd.executeBatch();
            }

            // 3. BIZ_STUDENT_PROFILE
            try (PreparedStatement sel = conn.prepareStatement("SELECT ID, MOBILE, EMERGENCY_CONTACT_MOBILE, INITIAL_PASSWORD, EXT_JSON FROM BIZ_STUDENT_PROFILE");
                 PreparedStatement upd = conn.prepareStatement("UPDATE BIZ_STUDENT_PROFILE SET MOBILE=?, EMERGENCY_CONTACT_MOBILE=?, INITIAL_PASSWORD=?, EXT_JSON=? WHERE ID=?")) {
                ResultSet rs = sel.executeQuery();
                while (rs.next()) {
                    String id = rs.getString("ID");
                    String mobile = rs.getString("MOBILE");
                    String emergencyMobile = rs.getString("EMERGENCY_CONTACT_MOBILE");
                    String initialPwd = rs.getString("INITIAL_PASSWORD");
                    JSONObject ext = parseJsonSafe(rs.getString("EXT_JSON"));

                    if (!ext.getBool("sm4_migrated", false)) {
                        String encMobile = encryptSm4Safe(mobile);
                        String encEmergency = encryptSm4Safe(emergencyMobile);
                        String encInitPwd = encryptSm4Safe(initialPwd);
                        ext.set("sm4_migrated", true);
                        upd.setString(1, encMobile);
                        upd.setString(2, encEmergency);
                        upd.setString(3, encInitPwd);
                        upd.setString(4, ext.toString());
                        upd.setString(5, id);
                        upd.addBatch();
                        spSm4Updated++;
                    }
                }
                upd.executeBatch();
            }

            conn.commit();
        }

        Assert.assertNotNull(defaultSm3);
        System.out.printf("SM3/SM4 标准化完成: sysPwd=%d, sysSm4=%d, cliPwd=%d, cliSm4=%d, spSm4=%d%n",
                sysPwdUpdated, sysSm4Updated, cliPwdUpdated, cliSm4Updated, spSm4Updated);
    }
}
