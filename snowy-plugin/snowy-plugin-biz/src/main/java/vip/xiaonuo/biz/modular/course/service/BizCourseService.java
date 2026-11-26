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
package vip.xiaonuo.biz.modular.course.service;

import cn.hutool.json.JSONObject;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.IService;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.multipart.MultipartFile;
import vip.xiaonuo.biz.modular.course.entity.BizCourse;
import vip.xiaonuo.biz.modular.course.param.BizCourseAddParam;
import vip.xiaonuo.biz.modular.course.param.BizCourseEditParam;
import vip.xiaonuo.biz.modular.course.param.BizCourseIdParam;
import vip.xiaonuo.biz.modular.course.param.BizCoursePageParam;
import vip.xiaonuo.biz.modular.org.param.BizOrgSelectorTreeParam;

import java.util.List;

/**
 * 课程信息Service接口
 *
 * @author migration-bot
 * @date 2026/11/25
 */
public interface BizCourseService extends IService<BizCourse> {

    Page<BizCourse> page(BizCoursePageParam param);

    List<BizCourse> listAll(String orgId);

    void add(BizCourseAddParam param);

    void edit(BizCourseEditParam param);

    void delete(List<BizCourseIdParam> idParamList);

    BizCourse detail(BizCourseIdParam idParam);

    BizCourse queryEntity(String id);

    void downloadImportTemplate(HttpServletResponse response);

    JSONObject importCourses(MultipartFile file, boolean dryRun);

    List<JSONObject> orgTreeSelector(BizOrgSelectorTreeParam param);
}
