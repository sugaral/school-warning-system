package vip.xiaonuo.biz.modular.client.service;

import cn.hutool.json.JSONObject;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;

public interface BizClientWarnsysService {

    JSONObject login(Map<String, Object> body);

    JSONObject wxLogin(Map<String, Object> body);

    void logout();

    JSONObject sendCode(Map<String, Object> body);

    JSONObject verifyCode(Map<String, Object> body);

    JSONObject recoveryOptions(Map<String, Object> body);

    JSONObject resetPassword(Map<String, Object> body);

    JSONObject bindWechat(Map<String, Object> body);

    JSONObject bindEmail(Map<String, Object> body);

    JSONObject bindPhone(Map<String, Object> body);

    JSONObject bindClass(Map<String, Object> body);

    List<JSONObject> availableClasses();

    JSONObject getProfile();

    JSONObject updateProfile(Map<String, Object> body);

    void changePassword(Map<String, Object> body);

    List<JSONObject> getTeachers();

    JSONObject today();

    List<JSONObject> weekly();

    JSONObject summaries(Map<String, String> query);

    List<JSONObject> courses();

    JSONObject warnings(Map<String, String> query);

    void confirmWarning(String id);

    JSONObject leaveRequests(Map<String, String> query);

    JSONObject createLeave(Map<String, Object> body);

    JSONObject appeals(Map<String, String> query);

    JSONObject createAppeal(Map<String, Object> body);

    List<JSONObject> classChangeRequests();

    JSONObject createClassChange(Map<String, Object> body);

    JSONObject inbox(Map<String, String> query);

    JSONObject inboxUnreadCount();

    void readInbox(String id);

    void readAllInbox();

    JSONObject getPreferences();

    JSONObject updatePreferences(Map<String, Object> body);

    List<JSONObject> activeSessions();

    JSONObject checkin(Map<String, Object> body);

    JSONObject uploadFile(MultipartFile file);

    void downloadFile(String id, HttpServletResponse response);
}
